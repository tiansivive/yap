/* eslint-disable no-restricted-syntax */
import { Action, AnyAction, ctl, Eff, Handler } from "@yap/utils/effects/freer";

/*
 * The stack of provenance a computation is currently under.
 *
 * monad.v2's track, as an effect: entries are pushed for the extent of a
 * subprogram and popped after it, and whatever needs stamping reads the stack
 * where it stands. There it was a field on the context that track replaced;
 * here the handler owns it, so nothing else has to carry it.
 *
 * Reading copies. What gets stamped has to keep the stack as it was at that
 * point rather than follow it as elaboration carries on.
 *
 * Stamping stays in the caller's hands, which is how v2 does it too — tell and
 * fail both read ctx.trace themselves:
 *
 *   const constrain = function* (constraint: Constraint) {
 *     yield* Log.tell([{ ...constraint, trace: yield* Track.trace() }]);
 *   };
 *
 *   const fail = function* (cause: Cause) {
 *     return yield* Fail.raise({ ...cause, provenance: yield* Track.trace() });
 *   };
 */
export function tracer<P>() {
	type Read = Action<"Trace.read", undefined, readonly P[]>;
	type Push = Action<"Trace.push", readonly P[], undefined>;
	type Pop = Action<"Trace.pop", undefined, undefined>;

	/** The stack as it stands, as its own array. */
	const trace = function* () {
		return yield* ctl.resume<Read>("Trace.read", undefined);
	};

	/* Misreads a P that is itself an array, which no provenance type should be. */
	const many = (provenance: P | readonly P[]): provenance is readonly P[] => Array.isArray(provenance);

	/** Run program under provenance, and leave the stack as it was after. */
	const track = function* <Row extends AnyAction, A>(provenance: P | readonly P[], program: Eff<Row, A>) {
		yield* ctl.resume<Push>("Trace.push", many(provenance) ? provenance : [provenance]);

		const value = yield* program;

		yield* ctl.resume<Pop>("Trace.pop", undefined);

		return value;
	};

	const handlers = (initial: readonly P[] = []): Handler<Read | Push | Pop, readonly P[]> => {
		/* This handler owns the stack; its clauses are the only way to move it. */
		const entries: P[] = [...initial];
		const marks: number[] = [];

		return {
			clauses: {
				"Trace.read": () => [...entries],

				"Trace.push": added => {
					marks.push(entries.length);
					entries.push(...added);

					return undefined;
				},

				"Trace.pop": () => {
					const mark = marks.pop();

					if (mark !== undefined) {
						entries.length = mark;
					}

					return undefined;
				},
			},

			/*
			 * What an aborted run was under when it stopped. A completed one has
			 * popped everything, so this is whatever it started with.
			 */
			output: () => [...entries],
		};
	};

	return { trace, track, handlers };
}
