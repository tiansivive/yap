import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";

import * as NF from "@qtt/elaboration/normalization";
import { match } from "ts-pattern";

export const inject = (label: string, value: EB.AST, tm: EB.AST): M.Elaboration<NF.Value> =>
	M.chain(M.ask(), ctx =>
		match(tm[1])
			.with({ type: "Neutral" }, ({ value: v }) => inject(label, value, [tm[0], v, tm[2]]))
			.with({ type: "Var" }, _ => {
				const r: NF.Row = { type: "variable", variable: EB.freshMeta() };
				const ctor = NF.evaluate(ctx.env, ctx.imports, EB.Constructors.Var(EB.freshMeta()));

				const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(r), "Explicit");
				const extended = NF.Constructors.App(ctor, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], r)), "Explicit");
				return M.fmap(M.tell("constraint", { type: "assign", left: inferred, right: tm[1] }), () => extended);
			})
			.with(
				{ type: "App", func: { type: "Lit", value: { type: "Atom" } }, arg: { type: "Row" } },
				({
					func: {
						value: { value },
					},
				}) => value === "Schema" || value === "Variant",
				({ func, arg }) => {
					const extended = NF.Constructors.App(func, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], arg.row)), "Explicit");
					return M.of(extended);
				},
			)
			.otherwise(_ => {
				throw new Error("Injection: Expected Row type");
			}),
	);
