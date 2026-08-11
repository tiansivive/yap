import { match, P } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as A from "fp-ts/lib/Array";
import * as O from "fp-ts/lib/Option";
import * as Rec from "fp-ts/lib/Record";

import * as EB from ".";
import * as NF from "./normalization";

import * as M from "./shared/effects";

import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import { freshMeta } from "./shared/supply";

import _ from "lodash";
import { extract } from "./inference/rows";
import { entries, set, update } from "@yap/utils";

import * as Err from "./shared/errors";
import { Liquid } from "@yap/verification/modalities";

import assert from "node:assert";

type Result = [EB.Term, Q.Usages];
export const check = (term: Src.Term, type: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> =>
	M.tracer.track({ tag: "src", type: "term", term, metadata: { action: "checking", against: type } }, function* () {
		const ctx = yield* M.reader.ask();

		const result = match<[Src.Term, NF.Value], M.Elaboration<[EB.Term, Q.Usages]>>([term, type])
			.with([{ type: "hole" }, P._], function* () {
				const k = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
				return [EB.Constructors.Var(yield* freshMeta(ctx.env.length, k)), []] satisfies Result;
			})
			.with(
				[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
				([tm, ty]) => tm.icit === ty.binder.icit,
				function* ([tm, ty]) {
					const bType = yield* NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));

					const ann = tm.annotation ? (yield* EB.check(tm.annotation, ty.binder.annotation))[0] : yield* NF.quote(ctx.env.length, ty.binder.annotation);

					return yield* M.reader.local(
						ctx => EB.bind(ctx, { type: "Lambda", variable: tm.variable }, ty.binder.annotation),
						(function* () {
							const [body, us] = yield* Check.val(tm.body, bType);
							// const [vu] = us;
							//yield* M.constrain({ type: "usage", expected: ty.binder.annotation.nf, computed: vu });
							return [EB.Constructors.Lambda(tm.variable, tm.icit, body, ann), us] satisfies Result;
						})(),
					);
				},
			)
			.with(
				[P._, { type: "Abs", binder: { type: "Pi" } }],
				([_, ty]) => ty.binder.icit === "Implicit",
				function* ([tm, ty]) {
					const ann = yield* NF.quote(ctx.env.length, ty.binder.annotation);

					return yield* M.reader.local(
						ctx => EB.bind(ctx, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted"),
						(function* () {
							const bType = yield* NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
							const [_tm, us] = yield* Check.val(tm, bType);
							const [vu] = us;
							//	yield* M.constrain({ type: "usage", expected: ty.binder.annotation[1], computed: vu });
							return [EB.Constructors.Lambda(ty.binder.variable, "Implicit", _tm, ann), us] satisfies Result;
						})(),
					);
				},
			)

			.with([{ type: "variant" }, NF.Patterns.Type], function* ([{ row }]) {
				const [r, us] = yield* Check.row(row, NF.Type, ctx.env.length);
				return [EB.Constructors.Variant(r), us] satisfies Result;
			})
			.with([{ type: "tuple" }, NF.Patterns.Type], function* ([{ row }]) {
				const [r, us] = yield* Check.row(row, NF.Type, ctx.env.length);
				return [EB.Constructors.Schema(r), us] satisfies Result;
			})
			.with([{ type: "struct" }, NF.Patterns.Type], function* ([{ row }]) {
				const [r, us] = yield* Check.row(row, NF.Type, ctx.env.length);

				const sigma = EB.Constructors.Sigma("$sig", EB.Constructors.Row(r), EB.Constructors.Schema(r));
				return [sigma, us] satisfies Result;
				//return [EB.Constructors.Schema(r), us] satisfies Result;
			})

			.with([{ type: "injection" }, NF.Patterns.Type], function* ([inj, ty]) {
				const [tm, us] = yield* Check.val(inj.value, ty);
				const [checked] = yield* Check.val(inj.term, ty);

				return [EB.Constructors.Inj(inj.label, tm, checked), us] satisfies Result;
			})
			// QUESTION: How to check the resulting proj type is a NF.Type? Should we?
			// .with([{ type: "projection"}, NF.Patterns.Type], function* ([proj, ty]) {
			// 	const [tm, inferred, us] = yield* EB.infer(proj);
			// 	return [EB.Constructors.Proj(proj.label, tm), us] satisfies Result;
			// })
			.with([{ type: "struct" }, NF.Patterns.HashMap], function* ([struct, hashmap]) {
				const [r, us] = yield* Check.row(struct.row, hashmap.value.func.arg, ctx.env.length);
				yield* M.constrain({
					type: "assign",
					left: hashmap.value.arg,
					right: NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }),
					lvl: ctx.env.length,
				});
				return [EB.Constructors.Struct(r), us] satisfies Result;
			})
			.with([{ type: "struct" }, NF.Patterns.Schema], function* ([tm, val]) {
				const bindings = yield* extract(tm.row, ctx.env.length);
				const [r, us] = yield* M.reader.local(
					ctx => entries(bindings).reduce((ctx, [label, type]) => EB.extendLabel(ctx, label, type), ctx),
					Check.row.traverse(tm.row, val.arg.row, Q.noUsage(ctx.env.length), bindings),
				);

				return [EB.Constructors.Struct(r), us] satisfies Result;
			})
			.with([{ type: "struct" }, NF.Patterns.Sigma], function* ([tm, sig]) {
				// Infer the struct to get the value row, apply the sigma closure, then re-check
				// the source struct against the resulting type. This elaborates the source struct
				// twice: once to infer (for the value row), once to check (preserving bidir checking).
				// TODO:QUESTION: can we avoid the double elaboration? e.g. extract values without full inference
				const [rtm] = yield* EB.infer(tm);

				const rv = yield* NF.normalize(rtm);
				assert(rv.type === "App" && rv.arg.type === "Row", "Expected struct term to evaluate to an application of a Row");
				const valueRow = rv.arg.row;
				const ty = yield* NF.apply(sig.binder, sig.closure, NF.Constructors.Row(valueRow));

				// The re-check evaluates each field value; sibling `:label` refs resolve through
				// ctx.sigma at eval time, so make the inferred field values visible.
				return yield* M.reader.local(c => EB.extendSigma(c, valueRow), Check.val(tm, ty));
			})
			.with([{ type: "match" }, NF.Patterns.Type], function* ([match, ty]) {
				const ast = yield* EB.infer(match.scrutinee);

				const alternatives = yield* M.traverse(
					match.alternatives,
					EB.Inference.Match.elaborate(ast, function* (src) {
						const [tm, us] = yield* EB.check(src, ty);
						return [tm, ty, us] satisfies EB.AST;
					}),
				);

				const [scrutinee, , sus] = ast;
				const tm = EB.Constructors.Match(
					scrutinee,
					alternatives.map(([alt]) => alt),
				);

				return [tm, sus] satisfies Result;
			})
			.with([{ type: "match" }, P._], function* ([m, ty]) {
				const ast = yield* EB.infer(m.scrutinee);
				const [scrutinee, , sus] = ast;
				// if (scrutinee.type !== "Var") {
				// 	const inferred = yield* EB.infer(m);
				// 	yield* M.constrain({ type: "assign", left: inferred[1], right: ty, lvl: ctx.env.length });
				// 	return [inferred[0], inferred[2]] satisfies Result;
				// }

				const narrow = (nf: NF.Value, quoted: EB.Term, ctx: EB.Context) => {
					const next = match(scrutinee)
						.with({ type: "Var", variable: { type: "Bound" } }, bound =>
							update(
								ctx,
								"env",
								F.flow(
									A.modifyAt<EB.Context["env"][number]>(bound.variable.index, set("nf", nf)),
									O.getOrElse(() => ctx.env),
								),
							),
						)
						.with({ type: "Var", variable: { type: "Free" } }, free =>
							update(ctx, "imports", imports =>
								F.pipe(
									imports,
									Rec.modifyAt(free.variable.name, set("0", quoted)),
									O.getOrElse(() => imports),
								),
							),
						)
						.with({ type: "Var", variable: { type: "Label" } }, label =>
							update(ctx, "sigma", sigma =>
								F.pipe(
									sigma,
									Rec.modifyAt(label.variable.name, set("value", nf)),
									O.getOrElse(() => sigma),
								),
							),
						)
						.otherwise(() => ctx);
					return next;
				};

				const alternatives = yield* M.traverse(
					m.alternatives,
					EB.Inference.Match.elaborate(ast, function* (src, [pat, _patty, , binders]) {
						const ctx = yield* M.reader.ask();
						const val = NF.Pats.evaluate(pat, ctx, binders);
						const quoted = yield* NF.quote(ctx.env.length, val);

						const [tm, us] = yield* M.reader.local(
							c => narrow(val, quoted, c),
							(function* () {
								const ctx = yield* M.reader.ask();
								const branchTy = yield* NF.normalize(yield* NF.quote(ctx.env.length, ty));
								return yield* EB.check(src, branchTy);
							})(),
						);

						//const [tm, us] = yield* EB.check(src, narrow(val));
						return [tm, ty, us] satisfies EB.AST;
					}),
				);

				const tm = EB.Constructors.Match(
					scrutinee,
					alternatives.map(([alt]) => alt),
				);

				return [tm, sus] satisfies Result;
			})
			.with(
				[
					{ type: "lit", value: { type: "Num" } },
					{ type: "Lit", value: { type: "Num" } },
				],
				([tm, val]) => {
					if (tm.value.value === val.value.value) {
						return M.of([EB.Constructors.Lit(tm.value), Q.noUsage(ctx.env.length)] satisfies Result);
					}
					return M.fail(Err.TypeMismatch(NF.Constructors.Lit(tm.value), val));
				},
			)
			.with([{ type: "lit", value: { type: "Num" } }, NF.Patterns.Type], ([tm, _]) => {
				return M.of([EB.Constructors.Lit(tm.value), Q.noUsage(ctx.env.length)] satisfies Result);
			})
			.with([P._, { type: "Modal" }], ([tm, val]) => Check.val(tm, val.value))
			.with([{ type: "modal" }, P._], function* ([tm, val]) {
				const [checked, us] = yield* Check.val(tm.term, val);

				const liquid = tm.modalities.liquid
					? yield* EB.Liquid.typecheck(tm.modalities.liquid, yield* NF.normalize(checked))
					: Liquid.Predicate.Neutral(checked);
				const quantity = tm.modalities.quantity ?? Q.Many;

				return [EB.Constructors.Modal(checked, { liquid, quantity }), us] satisfies Result;
			})

			.otherwise(([src, ty]) =>
				M.reader.local(
					ctx => (_.isEqual(ty, NF.Type) ? EB.muContext(ctx) : ctx),
					(function* () {
						const ast: EB.AST = yield* EB.infer(src);
						const [tm, inferred, us]: EB.AST = yield* EB.Icit.insert(ast);
						yield* M.constrain({ type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
						return [tm, us] satisfies Result;
					})(),
				),
			);

		const [tm, us] = yield* result;
		//yield* M.writer.tell({ types: [{ term: tm, nf: type, modalities: {} as any }] });

		return [tm, us];
	});

/**
 * Checks that the given row values all conform to the given type.
 */
const checkRow = (row: Src.Row, ty: NF.Value, lvl: number): M.Elaboration<[EB.Row, Q.Usages]> =>
	EB.Rows.withLabelContext(
		row,
		R.fold<Src.Term, Src.Variable, M.Elaboration<[EB.Row, Q.Usages]>>(
			row,
			(val, lbl, acc) =>
				(function* () {
					const [tm, us] = yield* Check.val(val, ty);
					const [r, usages]: [EB.Row, Q.Usages] = yield* acc;

					return [{ type: "extension", label: lbl, value: tm, row: r }, Q.add(us, usages)] satisfies [EB.Row, Q.Usages];
				})(),
			(v, acc) =>
				(function* () {
					const ctx = yield* M.reader.ask();
					const [tm, ty, us] = yield* EB.lookup(v, ctx);
					assert(tm.type === "Var", "Expected row variable in struct value check");
					yield* M.constrain({ type: "assign", left: ty, right: NF.Row, lvl: ctx.env.length });

					const [r, usages]: [EB.Row, Q.Usages] = yield* acc;

					const rvar: EB.Row = { type: "variable", variable: tm.variable };

					return [R.append(r, rvar), Q.add(us, usages)] satisfies [EB.Row, Q.Usages];
				})(),
			M.of<[EB.Row, Q.Usages]>([{ type: "empty" }, Q.noUsage(lvl)]),
		),
	);

const traverseRow = function* (r1: Src.Row, r2: NF.Row, us: Q.Usages, bindings: Record<string, NF.Value>): M.Elaboration<[EB.Row, Q.Usages]> {
	const result = match([r2, r1])
		.with([{ type: "empty" }, { type: "empty" }], () => M.of([{ type: "empty" }, us] satisfies [EB.Row, Q.Usages]))
		.with([{ type: "extension" }, { type: "empty" }], ([{ label }, r]) => M.fail(Err.MissingLabel(label, r)))

		.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) => {
			const rewritten = R.rewrite(r, label);
			if (E.isLeft(rewritten)) {
				return M.fail(Err.MissingLabel(label, r));
			}

			if (rewritten.right.type !== "extension") {
				return M.fail({ type: "Impossible", message: "Rewriting a row extension should result in another row extension" });
			}

			const { value: rv, row: rr } = rewritten.right;

			return M.reader.local(
				ctx => EB.extendLabel(ctx, label, value),
				(function* () {
					const [tm, tus] = yield* Check.val(rv, value);
					const type = bindings[label];
					if (!type) {
						throw new Error("Elaborating Row Extension: Label not found");
					}
					const ctx = yield* M.reader.ask();
					//const nf = NF.evaluate(ctx, tm);
					yield* M.constrain([{ type: "assign", left: value, right: type, lvl: ctx.env.length }]);

					const [rt, rus] = yield* Check.row.traverse(rr as Src.Row, row, us, bindings);
					const q = Q.add(tus, rus);
					const xtension = EB.Constructors.Extension(label, tm, rt);
					return [xtension, q] satisfies [EB.Row, Q.Usages];
				})(),
			);
		})
		.with([P._, { type: "variable" }], () => M.fail({ type: "Impossible", message: "Cannot have row var in a struct value" }))
		.with([{ type: "variable" }, { type: "empty" }], function* ([v, _e]) {
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row({ type: "empty" }), right: NF.Constructors.Row(v), lvl: ctx.env.length });
			return [{ type: "empty" }, us] satisfies [EB.Row, Q.Usages];
		})

		.with([{ type: "variable" }, { type: "extension" }], function* ([v, r]) {
			const collected = yield* EB.Rows.collect(r);
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
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.ty), right: NF.Constructors.Row(v), lvl: ctx.env.length });
			return [inferred.tm, us] satisfies [EB.Row, Q.Usages];
		})
		.with([P._, { type: "extension" }], ([r, { label }]) => M.fail(Err.MissingLabel(label, r)))
		.otherwise(_ => {
			throw new Error("Unknown row action");
		});

	return yield* result;
};

export const Check = {
	val: check,
	row: checkRow,
};
checkRow.traverse = traverseRow;
