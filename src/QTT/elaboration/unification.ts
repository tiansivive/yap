import { match, P } from "ts-pattern";
import _ from "lodash";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import { M } from "@qtt/elaboration";
import * as Sub from "@qtt/elaboration/substitution";
import { Subst } from "@qtt/elaboration/substitution";

import * as Err from "@qtt/elaboration/errors";
import * as R from "@qtt/shared/rows";

import * as Src from "@qtt/src/index";
import * as Log from "@qtt/shared/logging";
import { number } from "fp-ts";

const empty: Subst = {};
export const unify = (left: NF.Value, right: NF.Value, lvl: number): M.Elaboration<Subst> => {
	if (Log.peek() !== "unify") {
		Log.push("unify");
	}
	const lDisplay = NF.display(left);
	const rDisplay = NF.display(right);
	Log.logger.debug("[left] " + rDisplay);
	Log.logger.debug("[right] " + lDisplay);

	const res = match([left, right])
		.with([{ type: "Neutral" }, P._], ([n, v]) => unify(n.value, v, lvl))
		.with([P._, { type: "Neutral" }], ([v, n]) => unify(v, n.value, lvl))
		.otherwise(() =>
			M.track(
				["unify", [left, right], { action: "unification" }],
				match([left, right])
					.with([NF.Patterns.Lit, NF.Patterns.Lit], ([lit1, lit2]) => {
						if (!_.isEqual(lit1.value, lit2.value)) {
							return M.fail(Err.UnificationFailure(lit1, lit2));
						}
						return M.of(empty);
					})
					.with(
						[NF.Patterns.Lambda, NF.Patterns.Lambda],
						([lam1, lam2]) => lam1.binder.icit === lam2.binder.icit,
						([lam1, lam2]) =>
							M.chain(M.ask(), ctx => {
								const body1 = NF.apply(ctx.imports, lam1.closure, NF.Constructors.Rigid(lvl));
								const body2 = NF.apply(ctx.imports, lam2.closure, NF.Constructors.Rigid(lvl));
								return unify(body1, body2, lvl + 1);
							}),
					)

					.with(
						[NF.Patterns.Pi, NF.Patterns.Pi],
						([pi1, pi2]) => pi1.binder.icit === pi2.binder.icit,
						([pi1, pi2]) =>
							F.pipe(
								M.Do,
								M.let("ctx", M.ask()),
								M.let("sub", unify(pi1.binder.annotation[0], pi2.binder.annotation[0], lvl)),
								M.chain(({ ctx, sub }) => {
									const body1 = NF.apply(ctx.imports, pi1.closure, NF.Constructors.Rigid(lvl));
									const body2 = NF.apply(ctx.imports, pi2.closure, NF.Constructors.Rigid(lvl));
									return M.fmap(unify(body1, body2, lvl + 1), o => Sub.compose(ctx, o, sub));
								}),
							),
					)

					.with([NF.Patterns.Flex, P._], ([meta, v]) => M.fmap(M.ask(), ctx => bind(ctx, meta.variable, v)))
					.with([P._, NF.Patterns.Flex], ([v, meta]) => M.fmap(M.ask(), ctx => bind(ctx, meta.variable, v)))

					.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) => {
						if (!_.isEqual(rigid1.variable, rigid2.variable)) {
							return M.fail(Err.RigidVariableMismatch(rigid1, rigid2));
						}

						return M.of(empty);
					})

					.with([NF.Patterns.App, NF.Patterns.App], ([left, right]) =>
						F.pipe(
							M.Do,
							M.bind("ctx", M.ask),
							M.let("o1", unify(left.func, right.func, lvl)),
							M.let("o2", unify(left.arg, right.arg, lvl)),
							M.fmap(({ ctx, o1, o2 }) => Sub.compose(ctx, o2, o1)),
						),
					)
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

						const unify_ = (r1: NF.Row, r2: NF.Row, s: Subst): M.Elaboration<Subst> =>
							match([r1, r2])
								.with([{ type: "empty" }, { type: "empty" }], () => M.of(s))
								.with([{ type: "variable" }, P._], ([{ variable }, r]) => M.fmap(M.ask(), ctx => bind(ctx, variable, NF.Constructors.Row(r))))
								.with([P._, { type: "variable" }], ([r, { variable }]) => M.fmap(M.ask(), ctx => bind(ctx, variable, NF.Constructors.Row(r))))
								.with([{ type: "extension" }, P._], ([{ label, value, row }, r]) => {
									const intersection = A.intersection(number.Eq)(tail(row), Object.keys(s).map(Number));

									if (intersection.length !== 0) {
										throw new Error("Circular row type");
									}

									const finalSubst = M.chain(M.ask(), ctx => {
										const subst = Sub.Substitute(ctx);
										const [rewritten, o1] = rewrite(r);

										if (rewritten.type !== "extension") {
											throw new Error("Expected extension");
										}

										return F.pipe(
											M.Do,
											M.let("o2", unify(subst.nf(o1, value), subst.nf(o1, rewritten.value), ctx.env.length)),
											M.bind("o3", ({ o2 }) => unify_(substRow(ctx, o2, substRow(ctx, o1, row)), substRow(ctx, o2, substRow(ctx, o1, rewritten.row)), o2)),
											M.fmap(({ o2, o3 }) => Sub.compose(ctx, Sub.compose(ctx, o3, o2), o1)),
										);
									});
									const rewrite = (r: NF.Row): [NF.Row, Subst] =>
										match(r)
											.with({ type: "empty" }, (): [NF.Row, Subst] => {
												throw new Error("Did not find label: " + label + " in row: " + R.display({ term: NF.display, var: v => JSON.stringify(v) }));
											})
											.with(
												{ type: "extension" },
												({ label: l }) => label === l,
												({ label: l, value, row }): [NF.Row, Subst] => [R.Constructors.Extension(l, value, row), {}],
											)
											.with({ type: "extension" }, ({ label: lbl, value: val, row }): [NF.Row, Subst] =>
												match(rewrite(row))
													.with([{ type: "extension" }, P._], ([{ label: l, value: v, row: r }, sub]): [NF.Row, Subst] => [
														R.Constructors.Extension(l, v, R.Constructors.Extension(lbl, val, r)),
														sub,
													])
													.otherwise((): [NF.Row, Subst] => {
														throw new Error("Expected extension: " + R.display({ term: NF.display, var: v => JSON.stringify(v) }));
													}),
											)
											.with({ type: "variable" }, ({ variable }): [NF.Row, Subst] => {
												if (variable.type !== "Meta") {
													throw new Error("Expected meta variable");
												}

												const tvar = EB.freshMeta();
												const rvar: NF.Row = R.Constructors.Variable(tvar);
												const rf = R.Constructors.Extension(label, NF.Constructors.Var(tvar), rvar);
												const sub = { [variable.val]: NF.Constructors.Row(rf) };
												return [rf, sub];
											})
											.exhaustive();

									return finalSubst;
								})
								.otherwise(() => {
									throw new Error("Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'.");
								});

						return unify_(r1, r2, empty);
					})

					.otherwise(ts => M.fail(Err.TypeMismatch(left, right))), //TODO: Row Unification
			),
		);

	return M.fmap(res, subst => {
		Log.logger.debug("[Result] " + Sub.display(subst, " :|: "));

		if (Log.peek() === "unify") {
			Log.pop();
		}
		return subst;
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
		return { [v.val]: ty };
	}

	// solution is a mu type
	throw new Error("Unification: Occurs check failed. Need to implement mu type");
};

const occursCheck = (ctx: EB.Context, v: NF.Variable, ty: NF.Value): boolean =>
	match(ty)
		.with(NF.Patterns.Var, ({ variable }) => _.isEqual(variable, v))
		.with({ type: "Neutral" }, ({ value }) => occursCheck(ctx, v, value))
		.with(NF.Patterns.Lambda, ({ closure }) => occursCheck(ctx, v, NF.apply(ctx.imports, closure, NF.Constructors.Rigid(ctx.env.length))))
		.with(NF.Patterns.Pi, ({ closure }) => occursCheck(ctx, v, NF.apply(ctx.imports, closure, NF.Constructors.Rigid(ctx.env.length))))
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

const substRow = (ctx: EB.Context, subst: Subst, row: NF.Row): NF.Row =>
	match(row)
		.with({ type: "empty" }, () => row)
		.with({ type: "extension" }, ({ label, value, row }) => R.Constructors.Extension(label, Sub.Substitute(ctx).nf(subst, value), substRow(ctx, subst, row)))
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
