import { match, P } from "ts-pattern";
import _ from "lodash";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { M } from "@yap/elaboration";
import * as Sub from "./substitution";
import { Subst } from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import * as Src from "@yap/src/index";
import * as Log from "@yap/shared/logging";
import { number } from "fp-ts";
import { update } from "@yap/utils";

const empty: Subst = {};
export const unify = (left: NF.Value, right: NF.Value, lvl: number, subst: Subst): M.Elaboration<Subst> => {
	if (Log.peek() !== "unify") {
		Log.push("unify");
	}
	const lDisplay = NF.display(left);
	const rDisplay = NF.display(right);
	Log.logger.debug("[left] " + rDisplay);
	Log.logger.debug("[right] " + lDisplay);
	Log.logger.debug("[Level] " + lvl);

	const res = match([left, right])
		.with([{ type: "Neutral" }, P._], ([n, v]) => unify(n.value, v, lvl, subst))
		.with([P._, { type: "Neutral" }], ([v, n]) => unify(v, n.value, lvl, subst))
		.otherwise(() => {
			return M.track(
				["unify", [left, right], { action: "unification" }],
				match([left, right])
					.with([NF.Patterns.Flex, P._], ([meta, v]) => M.fmap(M.ask(), ctx => Sub.compose(ctx, bind(ctx, meta.variable, v), subst, lvl)))
					.with([P._, NF.Patterns.Flex], ([v, meta]) => M.fmap(M.ask(), ctx => Sub.compose(ctx, bind(ctx, meta.variable, v), subst, lvl)))
					.with([NF.Patterns.Lit, NF.Patterns.Lit], ([lit1, lit2]) => {
						if (!_.isEqual(lit1.value, lit2.value)) {
							return M.fail(Err.UnificationFailure(lit1, lit2));
						}
						return M.of(subst);
					})
					.with(
						[NF.Patterns.Lambda, NF.Patterns.Lambda],
						([lam1, lam2]) => lam1.binder.icit === lam2.binder.icit,
						([lam1, lam2]) =>
							M.chain(M.ask(), ctx => {
								const body1 = NF.apply(lam1.binder, lam1.closure, NF.Constructors.Rigid(lvl));
								const body2 = NF.apply(lam2.binder, lam2.closure, NF.Constructors.Rigid(lvl));
								return unify(body1, body2, lvl + 1, subst);
							}),
					)

					.with(
						[NF.Patterns.Pi, NF.Patterns.Pi],
						([pi1, pi2]) => pi1.binder.icit === pi2.binder.icit,
						([pi1, pi2]) => {
							Log.push("pi");
							Log.logger.debug("[Left] " + NF.display(pi1));
							Log.logger.debug("[Right] " + NF.display(pi2));
							const sol = F.pipe(
								M.Do,
								M.let("ctx", M.ask()),
								M.bind("sub", ({ ctx }) => {
									Log.push("annotation");
									return F.pipe(
										unify(pi1.binder.annotation[0], pi2.binder.annotation[0], lvl, subst),
										M.fmap(sub => Sub.compose(ctx, sub, subst, lvl)),
										M.discard(() => {
											Log.pop();
											return M.of(null);
										}),
									);
								}),
								M.chain(({ ctx, sub }) => {
									const body1 = NF.apply(pi1.binder, pi1.closure, NF.Constructors.Rigid(lvl));
									const body2 = NF.apply(pi2.binder, pi2.closure, NF.Constructors.Rigid(lvl));
									//FIXME: Temporary fix. We shouldn't rely on the context in unification. Just work with levels.
									// const ctx_ = { ...ctx, env: Array(lvl) };
									return unify(body1, body2, lvl + 1, sub);
									//return M.fmap(unify(body1, body2, lvl + 1, sub), o => Sub.compose(ctx_, o, sub, lvl + 1));
								}),
							);

							return sol;
						},
					)

					.with([NF.Patterns.Mu, NF.Patterns.Mu], ([mu1, mu2]) =>
						F.pipe(
							M.Do,
							M.let("ctx", M.ask()),
							M.bind("sub", ({ ctx }) =>
								M.fmap(unify(mu1.binder.annotation[0], mu2.binder.annotation[0], lvl, subst), sub => Sub.compose(ctx, sub, subst, lvl)),
							),
							M.chain(({ ctx, sub }) => {
								const body1 = NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(lvl));
								const body2 = NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(lvl));
								//return M.fmap(unify(body1, body2, lvl + 1, sub), o => Sub.compose(ctx, o, sub, lvl + 1));
								return unify(body1, body2, lvl + 1, sub);
							}),
						),
					)

					.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) => {
						if (!_.isEqual(rigid1.variable, rigid2.variable)) {
							return M.fail(Err.RigidVariableMismatch(rigid1, rigid2));
						}
						return M.of(subst);
					})

					.with([NF.Patterns.App, NF.Patterns.App], ([left, right]) => {
						return M.chain(M.ask(), ctx => {
							return match([left.func, right.func])
								.with(
									[NF.Patterns.Mu, P._],
									([, v]) => v.type !== "Abs" || v.binder.type !== "Mu",

									([mu, v]) => {
										const unfolded = NF.apply(mu.binder, mu.closure, NF.Constructors.Neutral(mu));
										const applied = unfolded.type === "Abs" ? NF.apply(unfolded.binder, unfolded.closure, left.arg) : unfolded;
										return unify(applied, right, lvl, subst);
									},
								)
								.with(
									[P._, NF.Patterns.Mu],
									([v]) => v.type !== "Abs" || v.binder.type !== "Mu",

									([v, mu]) => {
										const unfolded = NF.apply(mu.binder, mu.closure, NF.Constructors.Neutral(mu));
										const applied = unfolded.type === "Abs" ? NF.apply(unfolded.binder, unfolded.closure, right.arg) : unfolded;
										return unify(left, applied, lvl, subst);
									},
								)
								.otherwise(() =>
									F.pipe(
										M.Do,
										M.let("o1", unify(left.func, right.func, lvl, subst)),
										M.let("o2", unify(left.arg, right.arg, lvl, subst)),
										M.fmap(({ o1, o2 }) => Sub.compose(ctx, o2, o1, lvl)),
									),
								);
						});
					})
					.with([NF.Patterns.Row, NF.Patterns.Row], ([{ row: r1 }, { row: r2 }]) => {
						const tail = (row: NF.Row): number[] =>
							match(row)
								.with({ type: "empty" }, () => [])
								.with({ type: "extension" }, ({ row }) => tail(row))
								.with({ type: "variable" }, ({ variable }) =>
									match(variable)
										.with({ type: "Meta" }, ({ val }) => [val])
										.otherwise(() => []),
								)
								.exhaustive();

						const unify_ = (r1: NF.Row, r2: NF.Row, s: Subst): M.Elaboration<Subst> => {
							return match([r1, r2])
								.with([{ type: "empty" }, { type: "empty" }], () => M.of(s))
								.with(
									[{ type: "variable" }, { type: "variable" }],
									([{ variable: v1 }, { variable: v2 }]) => _.isEqual(v1, v2),
									() => M.of(s),
								)
								.with([{ type: "variable" }, P._], ([{ variable }, r]) => M.fmap(M.ask(), ctx => bind(ctx, variable, NF.Constructors.Row(r))))
								.with([P._, { type: "variable" }], ([r, { variable }]) => M.fmap(M.ask(), ctx => bind(ctx, variable, NF.Constructors.Row(r))))
								.with([{ type: "extension" }, P._], ([{ label, value, row }, r]) => {
									const intersection = A.intersection(number.Eq)(tail(row), Object.keys(s).map(Number));

									if (intersection.length !== 0) {
										throw new Error("Circular row type");
									}

									const finalSubst = M.chain(M.ask(), ctx => {
										const call = Sub.Substitute(ctx);
										//const [rewritten, o1] = rewrite(r);

										return F.pipe(
											rewrite(r),
											M.chain(([rewritten, o1]) => {
												if (rewritten.type !== "extension") {
													return M.fail(Err.Impossible("Expected extension"));
												}
												return M.of({ rewritten, o1 });
											}),
											M.bind("o2", ({ rewritten, o1 }) => unify(call.nf(o1, value, lvl), call.nf(o1, rewritten.value, lvl), lvl, subst)),
											M.bind("o3", ({ o1, o2, rewritten }) =>
												unify_(substRow(ctx, o2, substRow(ctx, o1, row, lvl), lvl), substRow(ctx, o2, substRow(ctx, o1, rewritten.row, lvl), lvl), o2),
											),
											M.fmap(({ o1, o2, o3 }) => Sub.compose(ctx, Sub.compose(ctx, o3, o2, lvl), o1, lvl)),
										);
									});

									// TODO: Use `rewrite` from `rows.ts`
									const rewrite = (r: NF.Row): M.Elaboration<[NF.Row, Subst]> => {
										return match(r)
											.with({ type: "empty" }, (): M.Elaboration<[NF.Row, Subst]> => M.fail(Err.RowMismatch(r1, r2, "Did not find label: " + label)))
											.with(
												{ type: "extension" },
												({ label: l }) => label === l,
												({ label: l, value, row }) => M.of<[NF.Row, Subst]>([R.Constructors.Extension(l, value, row), {}]),
											)
											.with(
												{ type: "extension" },
												({ label: lbl, value: val, row }): M.Elaboration<[NF.Row, Subst]> =>
													M.chain(rewrite(row), res =>
														match(res)
															.with([{ type: "extension" }, P._], ([{ label: l, value: v, row: r }, sub]) =>
																M.of<[NF.Row, Subst]>([R.Constructors.Extension(l, v, R.Constructors.Extension(lbl, val, r)), sub]),
															)
															.otherwise(() => M.fail(Err.Impossible("Expected extension: " + R.display({ term: NF.display, var: v => JSON.stringify(v) })))),
													),
											)
											.with({ type: "variable" }, ({ variable }): M.Elaboration<[NF.Row, Subst]> => {
												if (variable.type !== "Meta") {
													return M.fail(Err.Impossible("Expected meta variable"));
												}

												const tvar = NF.Constructors.Var(EB.freshMeta(lvl));
												const rvar: NF.Row = R.Constructors.Variable(EB.freshMeta(lvl));
												const rf = R.Constructors.Extension(label, tvar, rvar);
												const sub = { [variable.val]: NF.Constructors.Row(rf) };
												return M.of<[NF.Row, Subst]>([rf, sub]) as any;
											})
											.exhaustive();
									};

									return finalSubst;
								})
								.with([{ type: "empty" }, { type: "extension" }], ([, { label }]) => {
									throw new Error(`Label ${label} missing in ${NF.display(left)}`);
								})
								.with([{ type: "extension" }, { type: "empty" }], ([{ label }]) => {
									throw new Error(`Label ${label} missing in ${NF.display(right)}`);
								})
								.otherwise(r => {
									throw new Error(
										"Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'." + JSON.stringify(r),
									);
								});
						};

						return unify_(r1, r2, empty);
					})

					.with(
						// NOTE: Foreign variables are not strictly α-equivalent, but they get shadowed, so we can assume this is somewhat sound
						// ideally we'll want fully qualified names, but that's not yet implemented
						// SOLUTION: fully qualified names
						[
							{ type: "Var", variable: { type: "Foreign" } },
							{ type: "Var", variable: { type: "Foreign" } },
						],
						([ffi1, ffi2]) => ffi1.variable.name === ffi2.variable.name,
						() => M.of(subst),
					)
					.otherwise(ts => {
						return M.fail(Err.TypeMismatch(left, right));
					}),
			);
		});

	return M.chain(M.ask(), ctx => {
		return M.fmap(res, sub => {
			Log.logger.debug("[Result] " + Sub.display(sub, " :|: "));

			if (Log.peek() === "unify") {
				Log.pop();
			}
			return sub;
			//return Sub.compose(ctx, sub, subst, lvl);
		});
	});
};

const bind = (ctx: EB.Context, v: NF.Variable, ty: NF.Value): Subst => {
	if (v.type !== "Meta") {
		throw new Error("Unification: Can only bind meta variables");
	}

	if (ty.type === "Var" && _.isEqual(ty.variable, v)) {
		return empty;
	}

	if (!occursCheck(ctx, v, ty)) {
		if (ty.type === "Abs") {
			// NOTE: Pruning the environment to the level of the variable
			// Because closures capture the environment during elaboration, we ensure only the necessary variables are captured here
			// when unifying with a meta generated at a certain, lower level.
			// The other way around is not a problem, since the closure env already contains all the strictly necessary variables.

			// This is not an ideal solution, as it demands that metas contain the level at which they were generated.
			// An alternative would be higher-order unification, which is more complex to implement, but more powerful.
			//const _ty = { ...ty, closure: { ...ty.closure, env: ty.closure.env.slice(-v.lvl) } };
			const _ty = update(ty, "closure.ctx", ctx => EB.prune(ctx, v.lvl));
			return { [v.val]: _ty };
		}
		return { [v.val]: ty };
	}

	// solution is a mu type
	throw new Error("Unification: Occurs check failed. Need to implement mu type");
};

const occursCheck = (ctx: EB.Context, v: NF.Variable, ty: NF.Value): boolean =>
	match(ty)
		.with(NF.Patterns.Var, ({ variable }) => _.isEqual(variable, v))
		.with({ type: "Neutral" }, ({ value }) => occursCheck(ctx, v, value))
		.with(NF.Patterns.Lambda, ({ binder, closure }) => occursCheck(ctx, v, NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length))))
		.with(NF.Patterns.Pi, ({ binder, closure }) => occursCheck(ctx, v, NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length))))
		.with(NF.Patterns.App, ({ func, arg }) => occursCheck(ctx, v, func) || occursCheck(ctx, v, arg))

		.with(NF.Patterns.Row, ({ row }) =>
			R.fold(
				row,
				(nf, _, acc) => acc || occursCheck(ctx, v, nf),
				rv => rv.type === "Meta" && _.isEqual(rv, v),
				false,
			),
		)
		.otherwise(() => false);

const substRow = (ctx: EB.Context, subst: Subst, row: NF.Row, lvl: number): NF.Row =>
	match(row)
		.with({ type: "empty" }, () => row)
		.with({ type: "extension" }, ({ label, value, row }) =>
			R.Constructors.Extension(label, Sub.Substitute(ctx).nf(subst, value, lvl), substRow(ctx, subst, row, lvl)),
		)
		.with({ type: "variable" }, ({ variable }): NF.Row => {
			if (variable.type !== "Meta") {
				return row;
			}

			const val = subst[variable.val];

			if (!val) {
				return R.Constructors.Variable(variable);
			}

			if (val.type === "Row") {
				return val.row;
			}

			throw new Error("Substitute: Row variable is not a row or a variable. Got: " + NF.display(val));
		})
		.exhaustive();
