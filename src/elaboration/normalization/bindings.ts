/*
 * Eager binding bodies carry semantic levels. Opening transports their owned references through
 * values and lexical closure environments while Core indices retain their existing lookup slots.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/quoting.md
 */
import assert from "assert";
import { isMatching, match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "./syntax/term";
import { traverse } from "./syntax/traversal";

/** Opens an eagerly evaluated body at its consumer's next semantic level. */
export const open = ({ body }: NF.Value & { type: "Existential" }, level: number) => {
	if (body.level === level) {
		return body;
	}
	const levels = (current: number) => (current < body.level ? current : current + level - body.level);
	const contexts = new WeakMap<EB.Context, EB.Context>();
	const values = new WeakMap<NF.Value, NF.Value>();

	const term = (term: EB.Term): EB.Term =>
		EB.traverse(
			term,
			ref =>
				match(ref.variable)
					.with({ type: "DepLabel" }, { type: "NuLabel" }, variable => EB.Constructors.Var({ ...variable, annotation: value(variable.annotation) }))
					.otherwise(() => ref),
			value,
		);

	const context = (ctx: EB.Context): EB.Context => {
		const known = contexts.get(ctx);
		if (known) {
			return known;
		}
		/* Recursive closures share this shell while their environment is copied. */
		const out = { ...ctx };
		contexts.set(ctx, out);
		const rebuilt = {
			...ctx,
			/* EB.extend uses an Error sentinel for the type of an evaluation-only binding. */
			env: ctx.env.map(entry => ({
				...entry,
				nf: value(entry.nf),
				type: [entry.type[0], entry.type[1], entry.type[2] instanceof Error ? entry.type[2] : value(entry.type[2])],
			})),
			implicits: ctx.implicits.map(([nf, annotation]) => [value(nf), value(annotation)]),
			labels: Object.fromEntries(Object.entries(ctx.labels).map(([name, nf]) => [name, value(nf)])),
			sigma: Object.fromEntries(Object.entries(ctx.sigma).map(([name, entry]) => [name, { value: value(entry.value) }])),
			record: Object.fromEntries(
				Object.entries(ctx.record).map(([name, entry]) => [name, { term: entry.term && term(entry.term), value: entry.value && value(entry.value) }]),
			),
			local: ctx.local.map(frame => {
				const terms = term(EB.Constructors.Row(frame.terms));
				const types = frame.types && value(NF.Constructors.Row(frame.types));
				assert(isMatching(EB.CtorPatterns.Row, terms), "A field scope must retain its term row during binding");
				assert(isMatching(P.optional(NF.Patterns.Row), types), "A field scope must retain its type row during binding");
				return { ...frame, ctx: context(frame.ctx), terms: terms.row, types: types?.row };
			}),
		} satisfies EB.Context;
		Object.assign(out, rebuilt);
		return out;
	};

	const value = (nf: NF.Value): NF.Value => {
		const known = values.get(nf);
		if (known) {
			return known;
		}
		const out = { ...nf };
		values.set(nf, out);
		Object.assign(
			out,
			traverse(
				nf,
				ref =>
					match(ref.variable)
						.with({ type: "Bound" }, variable => NF.Constructors.Var({ ...variable, lvl: levels(variable.lvl) }))
						.with({ type: "DepLabel" }, variable => NF.Constructors.Var({ ...variable, lvl: levels(variable.lvl), annotation: value(variable.annotation) }))
						.with({ type: "NuLabel" }, variable => NF.Constructors.Var({ ...variable, annotation: value(variable.annotation) }))
						.otherwise(() => ref),
				term,
				{ context, level: levels },
			),
		);
		return out;
	};
	return { ctx: context(body.ctx), level, value: value(body.value) };
};
