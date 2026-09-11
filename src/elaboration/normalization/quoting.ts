import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import { display } from "./syntax/pretty";
import { callstack as Stack, Evaluation } from "./callstack";
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
			yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Lit(value));
		})
		.with({ type: "Var" }, function* ({ variable }) {
			yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 }));
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					yield* solved ? quote(lvl, solved) : Stack.answer<EB.Term>("quotation", EB.Constructors.Var(v));
				})
				.otherwise(function* (v) {
					yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Var(v));
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			const alternatives = closure.term.alternatives;

			yield* Stack.cont<EB.Term>(1, function* ([quoted]) {
				yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Match(quoted, alternatives));
			});

			yield* quote(lvl, scrutinee);
		})
		.with(NF.Patterns.StuckProj, function* ({ value: { label, base } }) {
			yield* Stack.cont<EB.Term>(1, function* ([quoted]) {
				yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Proj(label, quoted));
			});

			yield* quote(lvl, base);
		})
		.with(NF.Patterns.StuckInj, function* ({ value: { label, base, injected } }) {
			yield* Stack.cont<EB.Term>(1, function* ([value]) {
				yield* Stack.cont<EB.Term>(1, function* ([target]) {
					yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Inj(label, value, target));
				});

				yield* quote(lvl, base);
			});

			yield* quote(lvl, injected);
		})
		.with({ type: "Neutral" }, function* ({ value }) {
			yield* quote(lvl, value);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			yield* Stack.cont<EB.Term>(1, function* ([f]) {
				yield* Stack.cont<EB.Term>(1, function* ([a]) {
					yield* Stack.answer<EB.Term>("quotation", EB.Constructors.App(icit, f, a));
				});

				yield* quote(lvl, arg);
			});

			yield* quote(lvl, func);
		})
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			yield* Stack.cont(1, function* ([applied]) {
				yield* Stack.cont<EB.Term>(1, function* ([body]) {
					yield* Stack.cont<EB.Term>(1, function* ([ann]) {
						yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Lambda(variable, icit, body, ann));
					});

					yield* quote(lvl, annotation);
				});

				yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, applied));
			});

			yield* schedule.apply(binder, closure, NF.Constructors.Rigid(lvl));
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			yield* Stack.cont(1, function* ([applied]) {
				yield* Stack.cont<EB.Term>(1, function* ([body]) {
					yield* Stack.cont<EB.Term>(1, function* ([ann]) {
						yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Pi(variable, icit, ann, body));
					});

					yield* quote(lvl, annotation);
				});

				yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, applied));
			});

			yield* schedule.apply(binder, closure, NF.Constructors.Rigid(lvl));
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;

			yield* Stack.cont(1, function* ([applied]) {
				yield* Stack.cont<EB.Term>(1, function* ([body]) {
					yield* Stack.cont<EB.Term>(1, function* ([ann]) {
						yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Mu(variable, source, ann, body));
					});

					yield* quote(lvl, annotation);
				});

				yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, applied));
			});

			yield* schedule.apply(binder, closure, NF.Constructors.Rigid(lvl));
		})
		.with({ type: "Abs", binder: { type: "Sigma" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			yield* Stack.cont(1, function* ([applied]) {
				yield* Stack.cont<EB.Term>(1, function* ([body]) {
					yield* Stack.cont<EB.Term>(1, function* ([ann]) {
						yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Sigma(variable, ann, body));
					});

					yield* quote(lvl, annotation);
				});

				yield* M.reader.local(_ => closure.ctx, quote(lvl, applied));
			});

			// Apply with symbolic label neutrals so matches get stuck instead of crashing.
			// Analogous to Pi quoting applying with Rigid(lvl).
			yield* schedule.apply(binder, closure, NF.Constructors.Row(symbolicRow(annotation)));
		})
		.with({ type: "Row" }, function* ({ row }) {
			yield* Stack.cont<EB.Row>(1, function* ([quoted]) {
				yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Row(quoted));
			});

			yield* quoteRow(lvl, row);
		})
		.with({ type: "External" }, function* ({ name, args }) {
			yield* Stack.cont<EB.Term[]>(1, function* ([quoted]) {
				yield* Stack.answer<EB.Term>(
					"quotation",
					quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name })),
				);
			});

			yield* quoteEach(lvl, args);
		})
		.with({ type: "Modal" }, function* ({ value, modalities }) {
			yield* Stack.cont<EB.Term>(1, function* ([quoted]) {
				yield* Stack.cont<EB.Term>(1, function* ([liquid]) {
					yield* Stack.answer<EB.Term>("quotation", EB.Constructors.Modal(quoted, { quantity: modalities.quantity, liquid }));
				});

				yield* quote(lvl, modalities.liquid);
			});

			yield* quote(lvl, value);
		})
		.otherwise(function* (nf) {
			throw new Error("Quote: Not implemented yet: " + (yield* display(nf)));
		});
}

const quoteRow = function* (lvl: number, row: NF.Row): Evaluation<void> {
	yield* match(row)
		.with({ type: "empty" }, function* () {
			yield* Stack.answer<EB.Row>("quotation", { type: "empty" });
		})
		.with({ type: "extension" }, function* ({ label, value, row: rest }) {
			yield* Stack.cont<EB.Term>(1, function* ([quoted]) {
				yield* Stack.cont<EB.Row>(1, function* ([tail]) {
					yield* Stack.answer<EB.Row>("quotation", EB.Constructors.Extension(label, quoted, tail));
				});

				yield* quoteRow(lvl, rest);
			});

			yield* quote(lvl, value);
		})
		.with({ type: "variable" }, function* ({ variable }) {
			const v = match(variable)
				.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - b.lvl - 1 }))
				.otherwise(b => b);

			yield* Stack.answer<EB.Row>("quotation", { type: "variable", variable: v });
		})
		.exhaustive();
};

const quoteEach = function* (lvl: number, values: NF.Value[]): Evaluation<void> {
	if (values.length === 0) {
		yield* Stack.answer<EB.Term[]>("quotation", []);
		return;
	}

	const [head, ...tail] = values;

	yield* Stack.cont<EB.Term>(1, function* ([first]) {
		yield* Stack.cont<EB.Term[]>(1, function* ([rest]) {
			yield* Stack.answer<EB.Term[]>("quotation", [first, ...rest]);
		});

		yield* quoteEach(lvl, tail);
	});

	yield* quote(lvl, head);
};

export function* closeVal(value: NF.Value): Evaluation<void> {
	const ctx = yield* M.reader.ask();

	yield* Stack.cont<EB.Term>(1, function* ([term]) {
		yield* Stack.answer<NF.Closure>("quotation", { type: "Closure", ctx, term });
	});

	yield* quote(ctx.env.length + 1, value);
}
