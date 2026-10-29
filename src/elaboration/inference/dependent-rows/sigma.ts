import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import assert from "node:assert";

import { Patterns } from "./patterns";
import type { Source } from "./record";

/**
 * A Sigma row is elaborated like a group of mutually recursive top-level definitions, in two
 * phases: the row is first opened with one placeholder per field, so that every field can refer to
 * every other, and then the fields themselves are elaborated. The Sigma binder exists to make the
 * first phase possible, so its annotation only needs the field names, and each placeholder is
 * `Irrelevant`.
 */
export const placeholders = (source: Source): EB.Row =>
	match(source)
		.with(Patterns.Rows.Extension, ({ label, row }) =>
			R.Constructors.Extension<EB.Term, EB.Variable>(label, EB.Constructors.Lit({ type: "Atom", value: "Irrelevant" }), placeholders(row)),
		)
		.with(Patterns.Rows.Empty, Patterns.Rows.Variable, () => R.Constructors.Empty<EB.Term, EB.Variable>())
		.exhaustive();

export const witness = function* (row: EB.Row): M.Elaboration<NF.Row> {
	const value = yield* NF.normalize(EB.Constructors.Row(row));
	assert(value.type === "Row", "A prepared row must normalize to a row");

	return value.row;
};

export const fields = function* (source: Source): M.Elaboration<[EB.Row, Q.Usages]> {
	return yield* match(source)
		.with(Patterns.Rows.Empty, function* () {
			const ctx = yield* M.reader.ask();

			return [R.Constructors.Empty<EB.Term, EB.Variable>(), Q.noUsage(ctx.env.length)] satisfies [EB.Row, Q.Usages];
		})
		.with(Patterns.Rows.Extension, function* ({ label, value, row }) {
			/* A field may be a type or a value used as a singleton type, so it is inferred. A nested
			 * struct is read as a record type, so it is checked against `Type`. */
			const [term, usages] = yield* match(value)
				.with(Patterns.Terms.Struct, () => EB.check(value, NF.Type))
				.otherwise(function* () {
					const [term, , usages] = yield* EB.infer(value);
					return [term, usages] as const;
				});
			const [rest, restUsages] = yield* fields(row);

			return [R.Constructors.Extension(label, term, rest), Q.add(usages, restUsages)] satisfies [EB.Row, Q.Usages];
		})
		.with(Patterns.Rows.Variable, function* ({ variable }) {
			const ctx = yield* M.reader.ask();
			const [term, type, usages] = yield* EB.lookup(variable, ctx);
			assert(term.type === "Var", "Dependent row tails must elaborate to variables");
			yield* M.constrain({ type: "assign", left: type, right: NF.Row, lvl: ctx.env.length });

			return [R.Constructors.Variable(term.variable), usages] satisfies [EB.Row, Q.Usages];
		})
		.exhaustive();
};
