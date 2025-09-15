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

type Result = [EB.Term, Q.Usages];
export const check = (term: Src.Term, type: NF.Value): V2.Elaboration<[EB.Term, Q.Usages]> =>
	V2.track(
		["src", term, { action: "checking", against: type }],
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const result = match<[Src.Term, NF.Value], V2.Elaboration<[EB.Term, Q.Usages]>>([term, type])
				.with([{ type: "hole" }, P._], () =>
					V2.Do(function* () {
						const k = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
						return [EB.Constructors.Var(freshMeta(ctx.env.length, k)), []] satisfies Result;
					}),
				)
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) =>
						V2.Do(function* () {
							const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));

							return yield* V2.local(
								ctx => EB.bind(ctx, { type: "Lambda", variable: tm.variable }, ty.binder.annotation),
								V2.Do(function* () {
									const [body, us] = yield* Check.val.gen(tm.body, bType);
									const [vu] = us;
									yield* V2.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu });
									return [EB.Constructors.Lambda(tm.variable, tm.icit, body), us] satisfies Result;
								}),
							);
						}),
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) =>
						V2.Do(() =>
							V2.local(
								ctx => EB.bind(ctx, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted"),
								V2.Do(function* () {
									const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
									const [_tm, us] = yield* Check.val.gen(tm, bType);
									const [vu] = us;
									yield* V2.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu });
									return [EB.Constructors.Lambda(ty.binder.variable, "Implicit", _tm), us] satisfies Result;
								}),
							),
						),
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
				.with([{ type: "struct" }, NF.Patterns.HashMap], ([struct, hashmap]) =>
					V2.Do(function* () {
						const [r, us] = yield* Check.row.gen(struct.row, hashmap.value.func.arg, ctx.env.length);
						return [EB.Constructors.Struct(r), us] satisfies Result;
					}),
				)
				.with([{ type: "struct" }, NF.Patterns.Schema], ([tm, val]) =>
					V2.Do(function* () {
						const bindings = extract(tm.row, ctx.env.length);
						const [r, us] = yield* V2.local(
							ctx => entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx),
							Check.row.traverse(tm.row, val.arg.row, Q.noUsage(ctx.env.length), bindings),
						);

						return [EB.Constructors.Struct(r), us] satisfies Result;
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

			return yield* V2.pure(result);
		}),
	);

const checkRow = (row: Src.Row, ty: NF.Value, lvl: number): V2.Elaboration<[EB.Row, Q.Usages]> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const bindings = extract(row, ctx.env.length);

		return yield* V2.local(
			ctx => entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx),
			V2.Do(
				R.fold(
					row,
					(val, lbl, acc) =>
						function* () {
							const [tm, us] = yield* Check.val.gen(val, ty);
							const sigma = bindings[lbl];
							if (!sigma) {
								throw new Error("Elaborating Row Extension: Label not found");
							}

							const nf = NF.evaluate(ctx, tm);
							yield* V2.tell("constraint", [
								{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
								{ type: "assign", left: ty, right: sigma.ann, lvl: ctx.env.length },
							]);
							const [r, usages] = yield* acc();

							return [{ type: "extension", label: lbl, value: tm, row: r }, Q.add(us, usages)] satisfies [EB.Row, Q.Usages];
						},
					({ value }) => {
						throw new Error("Not implemented yet: Cannot have row var in a map value");
					},
					() => V2.lift<[EB.Row, Q.Usages]>([{ type: "empty" }, Q.noUsage(lvl)]),
				),
			),
		);
	});

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
