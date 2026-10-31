import * as EB from "@yap/elaboration";
import * as NF from "./syntax/term";

import { match } from "ts-pattern";

import * as A from "fp-ts/lib/Array";
import * as F from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";

import * as R from "@yap/shared/rows";

export const evaluate = (pat: EB.Pattern, ctx: EB.Context, binders: EB.Patterns.Binder[]): O.Option<NF.Value> => {
	const toRow = (r: R.Row<EB.Pattern, string>): O.Option<NF.Row> =>
		F.pipe(
			[...r.entries],
			A.traverse(O.Applicative)(({ label, value }) =>
				F.pipe(
					evaluate(value, ctx, binders),
					O.map(evaluated => ({ label, value: evaluated })),
				),
			),
			O.map(entries =>
				R.Constructors.Row<NF.Value, NF.Variable>(
					entries,
					r.tail === undefined ? undefined : { type: "Bound", lvl: ctx.env.length + binders.findIndex(([name]) => name === r.tail) },
				),
			),
		);
	return match<EB.Pattern, O.Option<NF.Value>>(pat)
		.with({ type: "Lit" }, ({ value }) => O.some(NF.Constructors.Lit(value)))

		.with({ type: "Binder" }, ({ value }) => {
			const idx = binders.findIndex(([name, _]) => name === value);
			return O.some(NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length + idx }));
		})
		.with({ type: "Var" }, () => {
			throw new Error("Var patterns are not implemented yet");
		})

		.with({ type: "Row" }, ({ row }) => {
			return F.pipe(toRow(row), O.map(NF.Constructors.Row));
		})

		.with({ type: "Struct" }, ({ row }) => {
			return F.pipe(toRow(row), O.map(NF.Constructors.Struct));
		})

		.with(
			{ type: "Variant", row: R.Patterns.NonEmpty },
			({
				row: {
					entries: [{ label, value }],
				},
			}) =>
				F.pipe(
					evaluate(value, ctx, binders),
					O.map(evaluated => NF.Constructors.Tagged(label, evaluated)),
				),
		)
		.with({ type: "Variant" }, ({ row }) => F.pipe(toRow(row), O.map(NF.Constructors.Variant)))

		.with({ type: "List" }, ({ patterns }) => {
			return F.pipe(
				patterns,
				A.traverse(O.Applicative)(p => evaluate(p, ctx, binders)),
				O.map(vs => {
					const r = vs.reduce<NF.Row>((r, v, i) => NF.Constructors.Extension(i.toString(), v, r), R.Constructors.Empty());
					return NF.Constructors.Array(r);
				}),
			);
		})

		.with({ type: "Wildcard" }, () => O.none)

		.otherwise(p => {
			throw new Error("patternToValue: missing case for pattern " + JSON.stringify(p));
		});
};
