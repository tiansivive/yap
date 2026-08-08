import { Action, ctl, Handler } from "@yap/utils/effects/freer";

/*
 * Abandoning a computation with an error.
 *
 * raise answers with never, so a call to it does not return and needs no value
 * at the use site.
 */

export function except<E>() {
	type Raise = Action<"Except.raise", E, E, "abort">;

	/* Answers with never, so a call to raise does not return. */
	const raise = function* (error: E) {
		return yield* ctl.abort<Raise>("Except.raise", error);
	};

	/*
	 * No catch. An abort breaks the loop, and nothing here can restart it from
	 * where the raise stood.
	 */
	const handlers = (): Handler<Raise, undefined> => ({
		clauses: { "Except.raise": error => error },
		output: () => undefined,
	});

	return { raise, handlers };
}

// ---------------------------------------------------------------------------
// Not called at import.
// ---------------------------------------------------------------------------
