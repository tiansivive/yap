import { match, P } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./shared/monad";

import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Log from "@yap/shared/logging";
import * as R from "@yap/shared/rows";

import { freshMeta } from "./shared/supply";

import _ from "lodash";
import { extract } from "./inference/rows";
import { entries, set } from "@yap/utils";

export function check(term: Src.Term, type: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	return M.track(
		["src", term, { action: "checking", against: type }],

		M.chain(M.ask(), ctx => {
			Log.push("check");
			Log.logger.debug("Checking", { Context: EB.Display.Context(ctx) });
			Log.logger.debug(Src.display(term));
			Log.logger.debug(NF.display(type));

			return match([term, type])
				.with([{ type: "hole" }, P._], () => {
					const k = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
					return M.of<[EB.Term, Q.Usages]>([EB.Constructors.Var(freshMeta(ctx.env.length, k)), []]);
				})
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) => {
						const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));

						const ctx_ = EB.bind(ctx, { type: "Lambda", variable: tm.variable }, ty.binder.annotation);
						return M.local(
							ctx_,
							F.pipe(
								check(tm.body, bType),
								M.discard(([, [vu]]) => M.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([body, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(tm.variable, tm.icit, body), us]),
							),
						);
					},
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) => {
						const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
						const ctx_ = EB.bind(ctx, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted");
						return M.local(
							ctx_,
							F.pipe(
								check(tm, bType),
								M.discard(([, [vu]]) => M.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([tm, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(ty.binder.variable, "Implicit", tm), us]),
							),
						);
					},
				)
				.with([{ type: "variant" }, NF.Patterns.Type], ([{ row }]) => {
					return M.fmap(checkRow(row, NF.Type, ctx.env.length), ([r, us]): [EB.Term, Q.Usages] => [EB.Constructors.Variant(r), us]);
					//M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Variant(row), NF.Type, qs]),
				})
				.with([{ type: "tuple" }, NF.Patterns.Type], ([{ row }]) => {
					return M.fmap(checkRow(row, NF.Type, ctx.env.length), ([r, us]): [EB.Term, Q.Usages] => [EB.Constructors.Schema(r), us]);
				})
				.with([{ type: "struct" }, NF.Patterns.Type], ([{ row }]) => {
					return M.fmap(checkRow(row, NF.Type, ctx.env.length), ([r, us]): [EB.Term, Q.Usages] => [EB.Constructors.Schema(r), us]);
				})
				.with([{ type: "struct" }, NF.Patterns.HashMap], ([struct, hashmap]) => {
					return M.fmap(checkRow(struct.row, hashmap.value.func.arg, ctx.env.length), ([r, us]): [EB.Term, Q.Usages] => [EB.Constructors.Struct(r), us]);
				})
				.with([{ type: "struct" }, NF.Patterns.Schema], ([tm, val]) => {
					const bindings = extract(tm.row, ctx.env.length);
					const extended = entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx);

					const _check = (r1: Src.Row, r2: NF.Row, us: Q.Usages): M.Elaboration<[EB.Row, Q.Usages]> => {
						return match([r1, r2])
							.with([{ type: "empty" }, { type: "empty" }], () => M.of<[EB.Row, Q.Usages]>([{ type: "empty" }, us]))
							.with([{ type: "empty" }, { type: "variable" }], () => M.of<[EB.Row, Q.Usages]>([{ type: "empty" }, us]))
							.with([{ type: "empty" }, { type: "extension" }], ([, { label }]) => M.fail({ type: "MissingLabel", label }))
							.with([{ type: "variable" }, P._], () => M.fail({ type: "Impossible", message: "Cannot have row var in a struct value" }))

							.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) => {
								const rewritten = R.rewrite(r, label);
								if (E.isLeft(rewritten)) {
									return M.fail({ type: "MissingLabel", label });
								}

								if (rewritten.right.type !== "extension") {
									return M.fail({ type: "Impossible", message: "Rewritting a row extension should result in another row extension" });
								}

								const { value: rv, row: rr } = rewritten.right;
								return M.local(
									ctx => set(ctx, `sigma.${label}.ann`, rv),
									F.pipe(
										M.Do,
										M.let("value", check(value, rv)),
										M.discard(({ value: [tm] }) => {
											const sigma = bindings[label];

											if (!sigma) {
												throw new Error("Elaborating Row Extension: Label not found");
											}

											const nf = NF.evaluate(ctx, tm);
											return M.track(
												["src", value, { action: "checking", against: rv }],
												M.tell("constraint", [
													{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
													// NOTE: Since in this case, we already know the type, we can remove the sigma check.
													// This also prevents emitting constraints of lambdas without inserted implicits against implicit pi types
													// QUESTION: Can we simplify the bindings extraction?
													//{ type: "assign", left: rv, right: sigma.ann, lvl: ctx.env.length }
												]),
											);
										}),
										M.let("row", _check(row as Src.Row, rr, us)),
										M.fmap(({ value, row }): [EB.Row, Q.Usages] => {
											const q = Q.add(value[1], row[1]);
											const tm = EB.Constructors.Extension(label, value[0], row[0]);
											return [tm, q];
										}),
									),
								);
							})
							.with([{ type: "extension" }, P._], ([{ label }, r]) => M.fail({ type: "MissingLabel", label }))
							.otherwise(r => {
								throw new Error("Unknown row action");
							});
					};

					return M.fmap(M.local(extended, _check(tm.row, val.arg.row, Q.noUsage(ctx.env.length))), ([r, us]): [EB.Term, Q.Usages] => [
						EB.Constructors.Struct(r),
						us,
					]);
				})

				.otherwise(([tm, ty]) => {
					return M.local(
						_.isEqual(ty, NF.Type) ? EB.muContext : ctx,
						F.pipe(
							EB.infer(tm),
							M.chain(EB.Icit.insert),
							M.discard(([, inferred]) => {
								return M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
							}),
							M.fmap(([tm, , us]): [EB.Term, Q.Usages] => [tm, us]),
						),
					);
				});
		}),
	);
}

const checkRow = (row: Src.Row, ty: NF.Value, lvl: number): M.Elaboration<[EB.Row, Q.Usages]> => {
	return M.chain(M.ask(), ctx => {
		const bindings = extract(row, ctx.env.length);
		const extended = entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx);

		return M.local(
			extended,
			R.fold(
				row,
				(val, lbl, acc) => {
					return F.pipe(
						M.Do,
						M.let("tm", check(val, ty)),
						M.discard(({ tm: [tm] }) => {
							const sigma = bindings[lbl];

							if (!sigma) {
								throw new Error("Elaborating Row Extension: Label not found");
							}

							const nf = NF.evaluate(ctx, tm);
							return M.tell("constraint", [
								{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
								{ type: "assign", left: ty, right: sigma.ann, lvl: ctx.env.length },
							]);
						}),
						M.let("acc", acc),
						M.fmap(({ tm: [value, us], acc: [r, usages] }): [EB.Row, Q.Usages] => {
							return [{ type: "extension", label: lbl, value, row: r }, Q.add(us, usages)];
						}),
					);
				},
				({ value }) => {
					throw new Error("Not implemented yet: Cannot have row var in a map value");
				},
				M.of<[EB.Row, Q.Usages]>([{ type: "empty" }, Q.noUsage(lvl)]),
			),
		);
	});
};
