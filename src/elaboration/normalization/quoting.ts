import * as EB from "@yap/elaboration";
import * as Eff from "@yap/utils/effects";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import { display } from "./syntax/pretty";
import { callstack as Stack, Frame, Evaluation } from "./callstack";
import { Do } from "./do";
import { schedule } from "./evaluation.v2";
import { match } from "ts-pattern";
import assert from "node:assert";

const symbolicRow = (annotation: NF.Value): NF.Row => {
	const go = (r: NF.Row): NF.Row =>
		match(r)
			.with({ type: "empty" }, (): NF.Row => ({ type: "empty" }))
			.with(
				{ type: "extension" },
				({ label, row }): NF.Row =>
					NF.Constructors.Extension(label, NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label })), go(row)),
			)
			.with({ type: "variable" }, (v): NF.Row => v)
			.exhaustive();

	assert(annotation.type === "Row", "Sigma annotation should be a Row");
	return go(annotation.row);
};

/**
 * Quotes a value at the given level, under the ambient context.
 * We explicitly pass the level to avoid extending the context when quoting under binders.
 * Closure bodies quote under their own stored context — closure consumption, via reader.local.
 *
 * Every sub-quotation is scheduled and its result arrives in a frame, so the traversal costs
 * machine frames rather than host ones; the depth of a quoted value is the depth of whatever
 * the program built, which is exactly what must not reach the host stack. Children are chained
 * rather than scheduled side by side, so each one is answered before the next is scheduled and
 * the order is the order the constructors read in.
 */
export function* quote(lvl: number, val: NF.Value): Evaluation<void> {
	yield* match(val)
		.with({ type: "Lit" }, function* ({ value }) {
			yield* Frame.of("quotation", EB.Constructors.Lit(value));
		})
		.with({ type: "Var" }, function* ({ variable }) {
			yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					yield* Frame.of("quotation", EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 }));
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					yield* solved ? quote(lvl, solved) : Frame.of("quotation", EB.Constructors.Var(v));
				})
				.otherwise(function* (v) {
					yield* Frame.of("quotation", EB.Constructors.Var(v));
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			const alternatives = closure.term.alternatives;

			yield* Do.bind("quotation", "quoted", () => quote(lvl, scrutinee)).chain(({ quoted }) =>
				Frame.of("quotation", EB.Constructors.Match(quoted, alternatives)),
			);
		})
		.with(NF.Patterns.StuckProj, ({ value: { label, base } }) =>
			Do.bind("quotation", "quoted", () => quote(lvl, base)).chain(({ quoted }) => Frame.of("quotation", EB.Constructors.Proj(label, quoted))),
		)
		.with(NF.Patterns.StuckInj, ({ value: { label, base, injected } }) =>
			Do.bind("quotation", "value", () => quote(lvl, injected))
				.bind("quotation", "target", () => quote(lvl, base))
				.chain(({ value, target }) => Frame.of("quotation", EB.Constructors.Inj(label, value, target))),
		)
		.with({ type: "Neutral" }, function* ({ value }) {
			yield* quote(lvl, value);
		})
		.with({ type: "App" }, ({ func, arg, icit }) =>
			Do.bind("quotation", "f", () => quote(lvl, func))
				.bind("quotation", "a", () => quote(lvl, arg))
				.chain(({ f, a }) => Frame.of("quotation", EB.Constructors.App(icit, f, a))),
		)
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			yield* Do.bind("applied", () => schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))
				.bind("quotation", "body", ({ applied }) => M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)))
				.bind("quotation", "ann", () => quote(lvl, annotation))
				.chain(({ body, ann }) => Frame.of("quotation", EB.Constructors.Lambda(variable, icit, body, ann)));
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			yield* Do.bind("applied", () => schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))
				.bind("quotation", "body", ({ applied }) => M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)))
				.bind("quotation", "ann", () => quote(lvl, annotation))
				.chain(({ body, ann }) => Frame.of("quotation", EB.Constructors.Pi(variable, icit, ann, body)));
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;

			yield* Do.bind("applied", () => schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))
				.bind("quotation", "body", ({ applied }) => M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)))
				.bind("quotation", "ann", () => quote(lvl, annotation))
				.chain(({ body, ann }) => Frame.of("quotation", EB.Constructors.Mu(variable, source, ann, body)));
		})
		.with({ type: "Abs", binder: { type: "Sigma" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			// Apply with symbolic label neutrals so matches get stuck instead of crashing.
			// Analogous to Pi quoting applying with Rigid(lvl).
			yield* Do.bind("applied", () => schedule.apply(binder, closure, NF.Constructors.Row(symbolicRow(annotation))))
				.bind("quotation", "body", ({ applied }) => M.reader.local(_ => closure.ctx, quote(lvl, applied)))
				.bind("quotation", "ann", () => quote(lvl, annotation))
				.chain(({ body, ann }) => Frame.of("quotation", EB.Constructors.Sigma(variable, ann, body)));
		})
		.with({ type: "Row" }, ({ row }) =>
			Do.bind("row", "quoted", () => quoteRow(lvl, row)).chain(({ quoted }) => Frame.of("quotation", EB.Constructors.Row(quoted))),
		)
		.with({ type: "External" }, function* ({ name, args }) {
			yield* Frame.cont("quotation", args.length, function* (quoted) {
				yield* Frame.of(
					"quotation",
					quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name })),
				);
			});

			/* Back to front: the driver pops last-in-first, so the arguments answer in order. */
			yield* Eff.traverse([...args].reverse(), arg => Stack.cont(0, () => quote(lvl, arg)));
		})
		.with({ type: "Modal" }, ({ value, modalities }) =>
			Do.bind("quotation", "quoted", () => quote(lvl, value))
				.bind("quotation", "liquid", () => quote(lvl, modalities.liquid))
				.chain(({ quoted, liquid }) => Frame.of("quotation", EB.Constructors.Modal(quoted, { quantity: modalities.quantity, liquid }))),
		)
		.otherwise(function* (nf) {
			throw new Error("Quote: Not implemented yet: " + (yield* display(nf)));
		});
}

const quoteRow = function* (lvl: number, row: NF.Row): Evaluation<void> {
	yield* match(row)
		.with({ type: "empty" }, function* () {
			yield* Frame.of("row", { type: "empty" });
		})
		.with({ type: "extension" }, ({ label, value, row: rest }) =>
			Do.bind("quotation", "quoted", () => quote(lvl, value))
				.bind("row", "tail", () => quoteRow(lvl, rest))
				.chain(({ quoted, tail }) => Frame.of("row", EB.Constructors.Extension(label, quoted, tail))),
		)
		.with({ type: "variable" }, function* ({ variable }) {
			const v = match(variable)
				.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - b.lvl - 1 }))
				.otherwise(b => b);

			yield* Frame.of("row", { type: "variable", variable: v });
		})
		.exhaustive();
};

export function* closeVal(value: NF.Value): Evaluation<void> {
	const ctx = yield* M.reader.ask();

	yield* Do.bind("quotation", "term", () => quote(ctx.env.length + 1, value)).chain(({ term }) => Frame.of("closure", { type: "Closure", ctx, term }));
}
