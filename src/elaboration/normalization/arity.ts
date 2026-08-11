import * as NF from "./syntax/term";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import { match, P } from "ts-pattern";

import { Evaluation } from "./callstack";
import { apply, unwrapNeutral } from "./evaluation.v2";

const { Patterns } = NF;

/**
 * Walk an App spine to its head (peeling Neutral along the way).
 */
const head = (v: NF.Value): NF.Value =>
	match(unwrapNeutral(v))
		.with(Patterns.App, ({ func }) => head(func))
		.otherwise(x => x);

/**
 * A type's head is "inert" when it cannot reduce to a Pi regardless of what
 * information becomes available. Concrete type constructors (Lit, Foreign) are
 * inert. Stuck rigids (Bound applied to args), unsolved metas, and stuck
 * matches are NOT inert — they could potentially hide more Pi binders.
 */
export const inert = (ty: NF.Value): boolean => {
	const val = unwrapNeutral(ty);
	return match(val)
		.with(Patterns.Flex, () => false)
		.with(Patterns.Pi, () => false)
		.with(Patterns.Modal, ({ value }) => inert(value))
		.with(Patterns.StuckMatch, () => false)
		.with(Patterns.StuckProj, () => false)
		.with(Patterns.StuckInj, () => false)
		.with(Patterns.App, app => {
			const h = head(app.func);
			return match(h)
				.with({ type: "Var", variable: { type: "Bound" } }, () => false)
				.with({ type: "Var", variable: { type: "Meta" } }, () => false)
				.otherwise(() => true);
		})
		.otherwise(() => true);
};

/**
 * Compute the runtime arity of a type by walking its Pi telescope.
 * Opens each binder with a fresh rigid via NbE. All Pi binders count
 * (implicits included — erasure is a separate concern handled by lowering).
 *
 * Throws if the return type has a non-inert head (value-dependent arity).
 */
export function* arity(ty: NF.Value): Evaluation<number> {
	const val = unwrapNeutral(ty);

	return yield* match(val)
		.with(Patterns.Pi, function* ({ binder, closure }) {
			const ctx = yield* M.reader.ask();
			const rigid = NF.Constructors.Rigid(ctx.env.length);
			const extended = EB.bind(ctx, { type: "Pi", variable: binder.variable }, binder.annotation);
			const returnType = yield* apply(binder, closure, rigid);

			return 1 + (yield* M.reader.local(_ => extended, arity(returnType)));
		})
		.with(
			P._,
			v => !inert(v),
			function* () {
				throw new Error("Foreign type has undecidable arity: head is not inert");
			},
		)
		.otherwise(function* () {
			return 0;
		});
}
