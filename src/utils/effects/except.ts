import { Action, ctl, Handler } from "@yap/utils/effects/freer";

/*
 * Abandoning a computation with an error.
 *
 * raise answers with never, so a call to it does not return and needs no value
 * at the use site.
 */

export function except<E>() {
	/* Answer type never: no handler can resume a raise, only abort with it. */
	type Raise = Action<"Except.raise", E, never>;

	const raise = function* (error: E) {
		return yield* ctl.action<Raise>("Except.raise", error);
	};

	/*
	 * The default handler aborts its installing scope with the error. A scope
	 * wanting to observe failure installs this (or its own clause) via Eff.with
	 * and reads the abort off the value slot.
	 */
	const handlers = (): Handler<Raise, undefined, E> => ({
		clauses: { "Except.raise": error => ctl.abort(error) },
		output: () => undefined,
	});

	return { raise, handlers };
}

// ---------------------------------------------------------------------------
// Not called at import.
// ---------------------------------------------------------------------------
