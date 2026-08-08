/* eslint-disable no-restricted-syntax */
import { Action, ctl, Handler } from "@yap/utils/effects/freer";

/*
 * A cell the handler owns, read back as that handler's output.
 *
 * State is not threaded through the answer, so an aborted run reports the cell
 * as it stood rather than rolling back.
 */

export function st<S>() {
	type Get = Action<"ST.get", undefined, S>;
	type Put = Action<"ST.put", S, void>;
	type Modify = Action<"ST.modify", (value: S) => S, S>;

	const get = function* () {
		return yield* ctl.resume<Get>("ST.get", undefined);
	};

	const put = function* (value: S) {
		return yield* ctl.resume<Put>("ST.put", value);
	};

	const modify = function* (update: (value: S) => S) {
		return yield* ctl.resume<Modify>("ST.modify", update);
	};

	const handlers = (initial: S): Handler<Get | Put | Modify, S> => {
		/* This handler owns the cell; its clauses are the only way to observe it. */
		let state = initial;

		return {
			clauses: {
				"ST.get": () => state,

				"ST.put": value => {
					state = value;
				},

				"ST.modify": update => {
					state = update(state);

					return state;
				},
			},

			output: () => state,
		};
	};

	return { get, put, modify, handlers };
}
