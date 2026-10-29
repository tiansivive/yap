import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";

import assert from "node:assert";

import { acyclic } from "./acyclic";
import { Patterns } from "./patterns";
import type { Inferred, Source } from "./record";

export const nu = function* <A extends Inferred>(row: Source, elaborate: () => M.Elaboration<A>) {
	const ctx = yield* M.reader.ask();
	const frame: EB.Frame = { labels: labels(row), ctx, types: R.Constructors.Empty(), terms: R.Constructors.Empty() };

	const elaborated = yield* M.reader.local(_ => EB.enter(frame), elaborate());
	yield* acyclic(elaborated.references);

	/* A `$label` that referred to a field not yet elaborated was given two placeholder metas, one for
	 * the field's value and one for its type. Every field is elaborated now, so each pair is assigned
	 * the value and type of the field it refers to. */
	const complete = { ...frame, terms: elaborated.term, types: elaborated.type };
	yield* M.traverse(
		Object.values(elaborated.references).flatMap(refs => refs.flatMap(({ label, meta, typeMeta }) => (meta && typeMeta ? [{ label, meta, typeMeta }] : []))),
		function* ({ label, meta, typeMeta }) {
			const term = R.lookup(elaborated.term, label);
			const type = R.lookup(elaborated.type, label);
			assert(term && type, "A referenced label names a field of its record");

			yield* fill(meta, yield* M.reader.local(_ => EB.enter(complete), NF.normalize(term)));
			yield* fill(typeMeta, type);
		},
	);

	const referenced = new Set(Object.values(elaborated.references).flatMap(refs => refs.map(({ label }) => label)));
	const annotation = yield* M.reader.local(_ => EB.enter(complete), NF.quote(ctx.env.length, NF.Constructors.Row(elaborated.type)));
	const binder = { mode: "strict", labels: frame.labels, scoped: requested(elaborated.term, referenced), annotation } as const;

	return [binder, elaborated] as const;
};

const labels = (row: Source): string[] =>
	match(row)
		.with(Patterns.Rows.Extension, ({ label, row }) => [label, ...labels(row)])
		.otherwise(() => []);

/**
 * Assigns a placeholder meta the value it stands for. The field it refers to is fully elaborated,
 * so that value is the meta's solution, and writing it to the registry makes it available to
 * everything elaborated afterwards. A meta can already have a solution by this point; that
 * solution has to agree with the field, so the two are unified.
 */
const fill = function* (meta: EB.Meta, value: NF.Value): M.Elaboration<void> {
	const ctx = yield* M.reader.ask();
	const registry = yield* Metas.registry.get();

	yield* match(Metas.solution(registry, meta.val))
		.with(P.nonNullable, () => M.constrain({ type: "assign", left: NF.Constructors.Flex(meta), right: value, lvl: ctx.env.length }))
		.otherwise(() => Metas.registry.modify(r => Metas.solve(r, meta.val, value)));
};

const requested = (row: EB.Row, names: ReadonlySet<string>): EB.Row =>
	match(row)
		.with(Patterns.Rows.Extension, ({ label, value, row }) =>
			names.has(label) ? R.Constructors.Extension(label, value, requested(row, names)) : requested(row, names),
		)
		.otherwise(() => R.Constructors.Empty<EB.Term, EB.Variable>());
