import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as F from "fp-ts/function";

type Projection = Extract<Src.Term, { type: "projection" }>;

export const infer = V2.regen(
	({ label, term }: Projection): V2.Elaboration<EB.AST> =>
		V2.track(
			{ tag: "src", type: "term", term, metadata: { action: "infer", description: "Projection of label: " + label } },
			V2.Do<EB.AST, EB.AST>(function* () {
				const [tm, ty, us] = yield* EB.infer.gen(term);
				const inferred = yield* project.gen(label, tm, ty, us);
				return [EB.Constructors.Proj(label, tm), inferred, us] satisfies EB.AST; // TODO: Subtract usages?
			}),
		),
);

export const project = (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): V2.Elaboration<NF.Value> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const nf = match(ty)
			.with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us))
			.with(NF.Patterns.Flex, _ =>
				V2.Do(function* () {
					// const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
					// const ann = NF.evaluate(ctx, rowTypeCtor);
					// const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));

					const ctor = NF.Constructors.Atom("Schema");

					//const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
					const kind = NF.Type;
					const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));

					const r: NF.Row = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
					const xtension = NF.Constructors.Extension(label, val, r);
					const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(xtension), "Explicit");

					yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty });

					return val;
				}),
			)
			.with(NF.Patterns.Schema, ({ func, arg }) =>
				V2.Do(function* () {
					const from = (l: string, row: NF.Row): V2.Elaboration<[NF.Row, NF.Value]> => {
						return match(row)
							.with({ type: "empty" }, _ => {
								return V2.Do(() => V2.fail<[NF.Row, NF.Value]>({ type: "MissingLabel", label: l, row }));
								//throw new Error("Label not found: " + l);
							})
							.with(
								{ type: "extension" },
								({ label: l_ }) => l === l_,
								({ label, value, row }) => V2.of<[NF.Row, NF.Value]>([NF.Constructors.Extension(label, value, row), value]),
							)
							.with({ type: "extension" }, r =>
								V2.Do(function* () {
									const [rr, vv]: [NF.Row, NF.Value] = yield from(l, r.row);
									return [NF.Constructors.Extension(r.label, r.value, rr), vv] satisfies [NF.Row, NF.Value];
								}),
							)
							.with({ type: "variable" }, r =>
								V2.Do(function* () {
									const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
									const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
									return [NF.Constructors.Extension(l, val, r), val] satisfies [NF.Row, NF.Value];
								}),
							)
							.exhaustive();
					};

					const [r, v]: [NF.Row, NF.Value] = yield from(label, arg.row);
					const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
					yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty });
					return v;
				}),
			)
			.with(NF.Patterns.Sigma, ({ binder, closure }) =>
				V2.Do(function* () {
					// Sigma types have the form: Σ(r: Row). Body(r)
					// The binder annotation is a Row type
					// We look up the label in the binder's row annotation

					if (binder.annotation.type !== "Row") {
						throw new Error("Sigma binder annotation must be a Row");
					}

					// Look up the label in the binder's row annotation
					const from = (l: string, row: NF.Row): V2.Elaboration<NF.Value> =>
						match(row)
							.with({ type: "empty" }, _ => V2.Do(() => V2.fail<NF.Value>({ type: "MissingLabel", label: l, row })))
							.with(
								{ type: "extension" },
								({ label: l_ }) => l === l_,
								({ value }) => V2.of<NF.Value>(value),
							)
							.with({ type: "extension" }, r => from(l, r.row))
							.with({ type: "variable" }, r =>
								V2.Do(function* () {
									const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
									const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
									const newRow = NF.Constructors.Extension(l, val, r);
									yield* V2.tell("constraint", {
										type: "assign",
										left: NF.Constructors.Row(newRow),
										right: NF.Constructors.Row(row),
										lvl: ctx.env.length,
									});
									return val;
								}),
							)
							.exhaustive();

					return yield* V2.pure(from(label, binder.annotation.row));
				}),
			)
			.otherwise(_ => {
				throw new Error("Expected Row Type");
			});

		return yield* V2.pure(nf);
	});

project.gen = F.flow(project, V2.pure);
