import { match, P } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as RCD from "fp-ts/lib/Record";
import * as A from "fp-ts/lib/Array";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./shared/monad";
import * as V2 from "./shared/monad.v2";

import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as R from "@yap/shared/rows";

import { freshMeta } from "./shared/supply";

import _ from "lodash";
import { extract } from "./inference/rows";
import { entries, set } from "@yap/utils";

import * as Err from "./shared/errors";
import { Liquid } from "@yap/verification/modalities";

type Result = [EB.Term, Q.Usages];
export const check = (term: Src.Term, type: NF.Value): V2.Elaboration<[EB.Term, Q.Usages]> =>
	V2.track(
		{ tag: "src", type: "term", term, metadata: { action: "checking", against: type } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const result = match<[Src.Term, NF.Value], V2.Elaboration<[EB.Term, Q.Usages]>>([term, type])
				.with([{ type: "hole" }, P._], () =>
					V2.Do(function* () {
						const k = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
						return [EB.Constructors.Var(yield* freshMeta(ctx.env.length, k)), []] satisfies Result;
					}),
				)
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) =>
						V2.Do(function* () {
							const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));

							const ann = tm.annotation ? (yield* EB.check.gen(tm.annotation, ty.binder.annotation))[0] : NF.quote(ctx, ctx.env.length, ty.binder.annotation);

							return yield* V2.local(
								ctx => EB.bind(ctx, { type: "Lambda", variable: tm.variable }, ty.binder.annotation),
								V2.Do(function* () {
									const [body, us] = yield* Check.val.gen(tm.body, bType);
									// const [vu] = us;
									//yield* V2.tell("constraint", { type: "usage", expected: ty.binder.annotation.nf, computed: vu });
									return [EB.Constructors.Lambda(tm.variable, tm.icit, body, ann), us] satisfies Result;
								}),
							);
						}),
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) =>
						V2.Do(() => {
							const ann = NF.quote(ctx, ctx.env.length, ty.binder.annotation);
							return V2.local(
								ctx => EB.bind(ctx, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted"),
								V2.Do(function* () {
									const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
									const [_tm, us] = yield* Check.val.gen(tm, bType);
									const [vu] = us;
									//	yield* V2.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu });
									return [EB.Constructors.Lambda(ty.binder.variable, "Implicit", _tm, ann), us] satisfies Result;
								}),
							);
						}),
				)

				.with([{ type: "variant" }, NF.Patterns.Type], ([{ row }]) =>
					V2.Do(function* () {
						const [r, us] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
						return [EB.Constructors.Variant(r), us] satisfies Result;
					}),
				)
				.with([{ type: "tuple" }, NF.Patterns.Type], ([{ row }]) =>
					V2.Do(function* () {
						const [r, us] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
						return [EB.Constructors.Schema(r), us] satisfies Result;
					}),
				)
				.with([{ type: "struct" }, NF.Patterns.Type], ([{ row }]) =>
					V2.Do(function* () {
						const [r, us] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
						return [EB.Constructors.Schema(r), us] satisfies Result;
					}),
				)
				.with([{ type: "injection" }, NF.Patterns.Type], ([inj, ty]) =>
					V2.Do(function* () {
						const [tm, us] = yield* Check.val.gen(inj.value, ty);
						const [checked] = yield* Check.val.gen(inj.term, ty);

						return [EB.Constructors.Inj(inj.label, tm, checked), us] satisfies Result;
					}),
				)
				// QUESTION: How to check the resulting proj type is a NF.Type? Should we?
				// .with([{ type: "projection"}, NF.Patterns.Type], ([proj, ty]) => V2.Do(function* () {
				// 	const [tm, inferred, us] = yield* EB.infer.gen(proj);
				// 	return [EB.Constructors.Proj(proj.label, tm), us] satisfies Result;
				// }))
				.with([{ type: "struct" }, NF.Patterns.HashMap], ([struct, hashmap]) =>
					V2.Do(function* () {
						const [r, us] = yield* Check.row.gen(struct.row, hashmap.value.func.arg, ctx.env.length);
						yield* V2.tell("constraint", {
							type: "assign",
							left: hashmap.value.arg,
							right: NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }),
							lvl: ctx.env.length,
						});
						return [EB.Constructors.Struct(r), us] satisfies Result;
					}),
				)
				.with([{ type: "struct" }, NF.Patterns.Schema], ([tm, val]) =>
					V2.Do(function* () {
						const bindings = yield* extract(tm.row, ctx.env.length);
						const [r, us] = yield* V2.local(
							ctx => entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx),
							Check.row.traverse(tm.row, val.arg.row, Q.noUsage(ctx.env.length), bindings),
						);

						return [EB.Constructors.Struct(r), us] satisfies Result;
					}),
				)
				.with([{ type: "match" }, NF.Patterns.Type], ([match, ty]) => {
					return V2.Do(function* () {
						const ast = yield* EB.infer.gen(match.scrutinee);
						const alternatives = yield* V2.pure(
							V2.traverse(
								match.alternatives,
								EB.Inference.Match.elaborate(ast, src =>
									V2.Do(function* () {
										const [tm, us] = yield* EB.check.gen(src, ty);
										return [tm, ty, us];
									}),
								),
							),
						);

						const [scrutinee, , sus] = ast;
						const tm = EB.Constructors.Match(
							scrutinee,
							alternatives.map(([alt]) => alt),
						);

						return [tm, sus] satisfies Result;
					});
				})
				.with(
					[
						{ type: "lit", value: { type: "Num" } },
						{ type: "Lit", value: { type: "Num" } },
					],
					([tm, val]) => {
						if (tm.value.value === val.value.value) {
							return V2.of([EB.Constructors.Lit(tm.value), Q.noUsage(ctx.env.length)] satisfies Result);
						}
						return V2.Do(() => V2.fail(Err.TypeMismatch(NF.Constructors.Lit(tm.value), val)));
					},
				)
				.with([{ type: "lit", value: { type: "Num" } }, NF.Patterns.Type], ([tm, _]) => {
					return V2.of([EB.Constructors.Lit(tm.value), Q.noUsage(ctx.env.length)] satisfies Result);
				})
				.with([P._, { type: "Modal" }], ([tm, val]) => Check.val(tm, val.value))
				.with([{ type: "modal" }, P._], ([tm, val]) =>
					V2.Do(function* () {
						const [checked, us] = yield* Check.val.gen(tm.term, val);

						const liquid = tm.modalities.liquid
							? yield* EB.Liquid.typecheck(tm.modalities.liquid, NF.evaluate(ctx, checked))
							: Liquid.Predicate.Neutral(checked);
						const quantity = tm.modalities.quantity ?? Q.Many;

						return [EB.Constructors.Modal(checked, { liquid, quantity }), us] satisfies Result;
					}),
				)

				.otherwise(([src, ty]) =>
					V2.Do(() =>
						V2.local(
							ctx => (_.isEqual(ty, NF.Type) ? EB.muContext(ctx) : ctx),
							V2.Do(function* () {
								const ast: EB.AST = yield* EB.infer.gen(src);
								const [tm, inferred, us]: EB.AST = yield* EB.Icit.insert.gen(ast);
								yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
								return [tm, us] satisfies Result;
							}),
						),
					),
				);

			const [tm, us] = yield* V2.pure(result);
			//yield* V2.tell("type", { term: tm, nf: type, modalities: {} as any });

			return [tm, us];
		}),
	);

/**
 * Checks that the given row values all conform to the given type.
 */
const checkRow = (row: Src.Row, ty: NF.Value, lvl: number): V2.Elaboration<[EB.Row, Q.Usages]> =>
	EB.Rows.inSigmaContext(
		row,
		R.fold(
			row,
			(val, lbl, acc) =>
				V2.Do(function* () {
					const ctx = yield* V2.ask();
					const [tm, us] = yield* Check.val.gen(val, ty);
					// const { constraints:cs, metas:ms } = yield* V2.listen();
					// console.log("Row Check Constraints:", cs);
					const sigma = ctx.sigma[lbl];
					if (!sigma) {
						throw new Error("Elaborating Row Extension: Label not found");
					}

					const nf = NF.evaluate(ctx, tm);
					yield* V2.tell("constraint", [
						{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
						{ type: "assign", left: ty, right: sigma.ann, lvl: ctx.env.length },
					]);
					// const { constraints, metas } = yield* V2.listen();
					// console.log("Row Check Constraints:", constraints);
					// console.log("Sigma:", sigma)
					const [r, usages]: [EB.Row, Q.Usages] = yield acc;

					return [{ type: "extension", label: lbl, value: tm, row: r }, Q.add(us, usages)] satisfies [EB.Row, Q.Usages];
				}),
			({ value }) => {
				throw new Error("Not implemented yet: Cannot have row var in a map value");
			},
			V2.of<[EB.Row, Q.Usages]>([{ type: "empty" }, Q.noUsage(lvl)]),
		),
		match(ty)
			.with(NF.Patterns.Type, () => true)
			.otherwise(() => false),
	);

const traverseRow = (r1: Src.Row, r2: NF.Row, us: Q.Usages, bindings: Record<string, EB.Sigma>): V2.Elaboration<[EB.Row, Q.Usages]> =>
	V2.Do(function* () {
		const result = match([r1, r2])
			.with([{ type: "empty" }, { type: "empty" }], () => V2.lift([{ type: "empty" }, us] satisfies [EB.Row, Q.Usages]))
			.with([{ type: "empty" }, { type: "variable" }], () => V2.lift([{ type: "empty" }, us] satisfies [EB.Row, Q.Usages]))
			.with([{ type: "empty" }, { type: "extension" }], ([r, { label }]) => V2.fail<[EB.Row, Q.Usages]>(Err.MissingLabel(label, r)))
			.with([{ type: "variable" }, P._], () => V2.fail<[EB.Row, Q.Usages]>({ type: "Impossible", message: "Cannot have row var in a struct value" }))

			.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) => {
				const rewritten = R.rewrite(r, label);
				if (E.isLeft(rewritten)) {
					return V2.fail<[EB.Row, Q.Usages]>(Err.MissingLabel(label, r));
				}

				if (rewritten.right.type !== "extension") {
					return V2.fail<[EB.Row, Q.Usages]>({ type: "Impossible", message: "Rewritting a row extension should result in another row extension" });
				}

				const { value: rv, row: rr } = rewritten.right;

				return V2.local(
					ctx => set(ctx, `sigma.${label}.ann`, rv),
					V2.Do(function* () {
						const [tm, tus] = yield* Check.val.gen(value, rv);
						const sigma = bindings[label];
						if (!sigma) {
							throw new Error("Elaborating Row Extension: Label not found");
						}
						const ctx = yield* V2.ask();
						const nf = NF.evaluate(ctx, tm);
						yield* V2.tell("constraint", [
							{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
							// NOTE: Since in this case, we already know the type, we can remove the sigma check.
							// This also prevents emitting constraints of lambdas without inserted implicits against implicit pi types
							// QUESTION: Can we simplify the bindings extraction?
							//{ type: "assign", left: rv, right: sigma.ann, lvl: ctx.env.length }
						]);

						const [rt, rus] = yield* Check.row.traverse.gen(row as Src.Row, rr, us, bindings);
						const q = Q.add(tus, rus);
						const xtension = EB.Constructors.Extension(label, tm, rt);
						return [xtension, q] satisfies [EB.Row, Q.Usages];
					}),
				);
			})
			.with([{ type: "extension" }, { type: "variable" }], function* ([r, v]) {
				const collected = yield* EB.Rows.collect.gen(r);
				if (collected.tail) {
					throw new Error("Cannot have row variables in struct values");
				}
				const inferred = collected.fields.reduce<{ tm: EB.Row; ty: NF.Row }>(
					(acc, { label, value, term }) => ({
						tm: EB.Constructors.Extension(label, term, acc.tm),
						ty: NF.Constructors.Extension(label, value, acc.ty),
					}),
					{ tm: { type: "empty" }, ty: { type: "empty" } },
				);
				yield* V2.tell("constraint", { type: "assign", left: NF.Constructors.Row(inferred.ty), right: NF.Constructors.Row(v) });
				return [inferred.tm, us] satisfies [EB.Row, Q.Usages];
			})
			.with([{ type: "extension" }, P._], ([{ label }, r]) => V2.fail<[EB.Row, Q.Usages]>(Err.MissingLabel(label, r)))
			.otherwise(r => {
				throw new Error("Unknown row action");
			});

		return yield* result;
	});

export const Check = {
	val: check,
	row: checkRow,
};
check.gen = F.flow(check, V2.pure);
checkRow.gen = F.flow(checkRow, V2.pure);
checkRow.traverse = traverseRow;
traverseRow.gen = F.flow(traverseRow, V2.pure);
