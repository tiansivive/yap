import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as F from "fp-ts/function";

type Projection = Extract<EB.Term, { type: "projection" }>;

export const infer = ({ label, term }: Projection): M.Elaboration<EB.AST> =>
	F.pipe(
		M.Do,
		M.let("term", infer(term)),
		M.bind("inferred", ({ term: [tm, ty, us] }) => EB.Proj.project(label, tm, ty, us)),
		M.fmap(({ term: [tm, , us], inferred }): EB.AST => [EB.Constructors.Proj(label, tm), inferred, us]), // TODO: Subtract usages?
	);

export const project = (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): M.Elaboration<NF.Value> =>
	M.chain(M.ask(), ctx =>
		match(ty)
			.with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us))
			.with({ type: "Var" }, _ => {
				const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", Q.Many, EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
				const ann = NF.evaluate(ctx, rowTypeCtor);
				const ctor = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length, ann)));

				const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
				const val = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind)));

				const r: NF.Row = { type: "variable", variable: EB.freshMeta(ctx.env.length, NF.Row) };
				const inferred = NF.Constructors.App(ctor, { type: "Row", row: NF.Constructors.Extension(label, val, r) }, "Explicit");

				return M.fmap(M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length }), () => inferred);
			})
			.with(
				NF.Patterns.Schema,
				({
					func: {
						value: { value },
					},
				}) => value === "Schema" || value === "Variant",
				({ func, arg }) => {
					const from = (l: string, row: NF.Row): [NF.Row, NF.Value] =>
						match(row)
							.with({ type: "empty" }, _ => {
								throw new Error("Label not found: " + l);
							})
							.with(
								{ type: "extension" },
								({ label: l_ }) => l === l_,
								({ label, value, row }): [NF.Row, NF.Value] => [NF.Constructors.Extension(label, value, row), value],
							)
							.with({ type: "extension" }, (r): [NF.Row, NF.Value] => {
								const [rr, vv] = from(l, r);
								return [NF.Constructors.Extension(r.label, r.value, rr), vv];
							})
							.with({ type: "variable" }, (r): [NF.Row, NF.Value] => {
								const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
								const val = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind)));
								return [NF.Constructors.Extension(l, val, r), val];
							})
							.exhaustive();

					const [r, v] = from(label, arg.row);
					const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
					return M.fmap(M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length }), () => v);
				},
			)
			.otherwise(_ => {
				throw new Error("Expected Row Type");
			}),
	);
