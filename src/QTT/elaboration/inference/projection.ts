import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as NF from "@qtt/elaboration/normalization";
import { match } from "ts-pattern";

export const project = (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): M.Elaboration<NF.Value> =>
	M.chain(M.ask(), ctx =>
		match(ty)
			.with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us))
			.with({ type: "Var" }, _ => {
				const r: NF.Row = { type: "variable", variable: EB.freshMeta(ctx.env.length) };
				const ctor = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length)));
				const val = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length)));

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
								const val = NF.evaluate(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length)));
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
