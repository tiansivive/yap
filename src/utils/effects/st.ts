/* eslint-disable no-restricted-syntax */
import { Action, AnyAction, ctl, Eff, Handler } from "@yap/utils/effects/freer";

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
		return yield* ctl.action<Get>("ST.get", undefined);
	};

	const put = function* (value: S) {
		return yield* ctl.action<Put>("ST.put", value);
	};

	const modify = function* (update: (value: S) => S) {
		return yield* ctl.action<Modify>("ST.modify", update);
	};

	const local = function* <K extends keyof S, Row extends AnyAction, A>(field: K, value: S[K], program: Eff<Row, A>) {
		const saved = (yield* get())[field];
		yield* modify(state => ({ ...state, [field]: value }));
		const result = yield* program;
		yield* modify(state => ({ ...state, [field]: saved }));
		return result;
	};

	const handlers = (initial: S): Handler<Get | Put | Modify, S> => {
		/* This handler owns the cell; its clauses are the only way to observe it. */
		let state = initial;

		return {
			clauses: {
				"ST.get": () => ctl.resume(state),

				"ST.put": value => {
					state = value;

					return ctl.resume(undefined);
				},

				"ST.modify": update => {
					state = update(state);

					return ctl.resume(state);
				},
			},

			output: () => state,
		};
	};

	return { get, put, modify, local, handlers };
}
