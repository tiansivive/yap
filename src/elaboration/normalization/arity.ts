import * as NF from "./syntax/term";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import { match } from "ts-pattern";

import type { Evaluation } from "./effects";
import { apply, view, View } from "./evaluation.v2";

const { Patterns } = NF;

/**
 * Walk an App spine to its head.
 */
function* head(v: NF.Value): Evaluation<NF.Value> {
	const { value } = yield* view(v);

	return yield* match(value)
		.with(Patterns.App, ({ func }) => head(func))
		.otherwise(function* (x) {
			return x;
		});
}

/**
 * A type's head is "inert" when it cannot reduce to a Pi regardless of what
 * information becomes available. Concrete type constructors (Lit, Foreign) are
 * inert. Stuck rigids (Bound applied to args), unsolved metas, and stuck
 * eliminations are NOT inert — they could potentially hide more Pi binders.
 */
export function* inert(ty: NF.Value): Evaluation<boolean> {
	return yield* match(yield* view(ty))
		.with(View.Flex, View.Blocked(), View.Sealed(Patterns.Pi), function* () {
			return false;
		})
		.with(View.Sealed(Patterns.Modal), ({ value }) => inert(value.value))
		.with(View.Sealed(Patterns.App), View.Symbolic(Patterns.App), function* ({ value: app }) {
			return match(yield* head(app.func))
				.with(Patterns.Rigid, Patterns.Flex, () => false)
				.otherwise(() => true);
		})
		.otherwise(function* () {
			return true;
		});
}

/**
 * Compute the runtime arity of a type by walking its Pi telescope.
 * Opens each binder with a fresh rigid via NbE. All Pi binders count
 * (implicits included — erasure is a separate concern handled by lowering).
 *
 * Throws if the return type has a non-inert head (value-dependent arity).
 */
export function* arity(ty: NF.Value): Evaluation<number> {
	return yield* match(yield* view(ty))
		.with(View.Sealed(Patterns.Pi), function* ({ value: { binder, closure } }) {
			const ctx = yield* M.reader.ask();
			const rigid = NF.Constructors.Rigid(ctx.env.length);
			const extended = EB.bind(ctx, { type: "Pi", variable: binder.variable }, binder.annotation);
			const returnType = yield* apply(binder, closure, rigid);

			return 1 + (yield* M.reader.local(_ => extended, arity(returnType)));
		})
		.otherwise(function* () {
			return yield* match(yield* inert(ty))
				.with(true, function* () {
					return 0;
				})
				.with(false, function* () {
					throw new Error("Foreign type has undecidable arity: head is not inert");
				})
				.exhaustive();
		});
}
