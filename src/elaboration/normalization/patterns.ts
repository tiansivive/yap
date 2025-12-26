import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import { match } from "ts-pattern";

import * as R from "@yap/shared/rows";

import * as Lit from "@yap/shared/literals";

export const evaluate = (pat: EB.Pattern, ctx: EB.Context, binders: EB.Patterns.Binder[]): NF.Value => {
	const toRow = (r: R.Row<EB.Pattern, string>): NF.Row => {
		if (r.type === "empty") {
			return R.Constructors.Empty();
		}
		if (r.type === "variable") {
			const idx = binders.findIndex(([name, _]) => name === r.variable);
			return { type: "variable", variable: { type: "Bound", lvl: ctx.env.length + idx } };
		}
		const { label, value, row: tail } = r;
		return NF.Constructors.Extension(label, evaluate(value, ctx, binders), toRow(tail));
	};
	return match<EB.Pattern, NF.Value>(pat)
		.with({ type: "Lit" }, ({ value }) => NF.Constructors.Lit(value))

		.with({ type: "Binder" }, ({ value }) => {
			const idx = binders.findIndex(([name, _]) => name === value);
			return NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length + idx });
		})
		.with({ type: "Var" }, ({}) => {
			throw new Error("Var patterns are not implemented yet");
		})

		.with({ type: "Row" }, ({ row }) => {
			return NF.Constructors.Row(toRow(row));
		})

		.with({ type: "Struct" }, ({ row }) => {
			return NF.Constructors.Struct(toRow(row));
		})

		.with({ type: "Variant" }, ({ row }) => {
			return NF.Constructors.Variant(toRow(row));
		})

		.with({ type: "List" }, ({ patterns, rest }) => {
			const vs = patterns.map(p => evaluate(p, ctx, binders));

			const r = vs.reduce<NF.Row>((r, v, i) => NF.Constructors.Extension(i.toString(), v, r), R.Constructors.Empty());
			return NF.Constructors.Array(r);
		})

		.with({ type: "Wildcard" }, _ => {
			// Wildcard: "some value" of the appropriate type; represent as meta
			// const kind = NF.Constructors.Var(EB.freshMetaSync(ctx.env.length, NF.Type));
			// return NF.Constructors.Var(EB.freshMetaSync(ctx.env.length, kind));
			// throw new Error("eval pat: wildcards not implemented");
			return NF.Constructors.Lit(Lit.Atom("wildcard"));
		})

		.otherwise(p => {
			throw new Error("patternToValue: missing case for pattern " + JSON.stringify(p));
		});
};
