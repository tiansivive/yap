import { Action, ctl, Handler } from "@yap/utils/effects/freer";

/*
 * A source of fresh numbers, one counter per kind.
 *
 * State that only moves forward: fresh answers the next number for a kind, and
 * no action moves a counter backwards or reads one without bumping it. The
 * handler owns the counters and reports them as its output, so a later run can
 * pick up where this one stopped.
 */

export function supply<K extends string>() {
	type Fresh = Action<"Supply.fresh", K, number>;

	/** The next number for kind, counting from 1. */
	const fresh = function* (kind: K) {
		return yield* ctl.resume<Fresh>("Supply.fresh", kind);
	};

	const handlers = (initial: Partial<Record<K, number>> = {}): Handler<Fresh, Partial<Record<K, number>>> => {
		/* This handler owns the counters; fresh is the only way to move them. */
		const counts: Partial<Record<K, number>> = { ...initial };

		return {
			clauses: {
				"Supply.fresh": kind => {
					const next = (counts[kind] ?? 0) + 1;
					counts[kind] = next;

					return next;
				},
			},

			output: () => ({ ...counts }),
		};
	};

	return { fresh, handlers };
}
