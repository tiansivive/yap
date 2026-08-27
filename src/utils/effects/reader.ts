/* eslint-disable no-restricted-syntax */
import { Action, AnyAction, ctl, Eff, Handler } from "@yap/utils/effects/freer";

/*
 * An environment threaded through a computation, replaceable over a subprogram.
 *
 * local is a generator over a push and a pop action rather than a control, so
 * scoping needs nothing from the interpreter. An aborted run leaves its scope
 * unpopped, which costs nothing since the run is over.
 *
 * The optional namespace parameter produces unique action tags so multiple
 * reader instances can coexist without intercepting each other's actions.
 */

export function reader<R>(ns = "Reader" as const) {
	type Ask = Action<`${typeof ns}.ask`, undefined, R>;
	type Asks = Action<`${typeof ns}.asks`, (environment: R) => unknown, unknown>;
	type Push = Action<`${typeof ns}.push`, (environment: R) => R, undefined>;
	type Pop = Action<`${typeof ns}.pop`, undefined, undefined>;

	const ask = function* () {
		return yield* ctl.action<Ask>(`${ns}.ask`, undefined);
	};

	/* Generic on the wrapper, so the answer follows the projection per call. */
	const asks = function* <A>(project: (environment: R) => A) {
		return yield* ctl.action<Action<`${typeof ns}.asks`, (environment: R) => A, A>>(`${ns}.asks`, project);
	};

	const local = function* <Row extends AnyAction, A>(modify: (environment: R) => R, program: Eff<Row, A>) {
		yield* ctl.action<Push>(`${ns}.push`, modify);

		const value = yield* program;

		yield* ctl.action<Pop>(`${ns}.pop`, undefined);

		return value;
	};

	const handlers = (initial: R): Handler<Ask | Asks | Push | Pop, undefined> => {
		/* This handler owns the scopes; its clauses are the only way to move them. */
		const scopes: R[] = [initial];
		const current = () => scopes[scopes.length - 1];

		return {
			clauses: {
				[`${ns}.ask` as const]: () => ctl.resume(current()),
				[`${ns}.asks` as const]: (project: (environment: R) => unknown) => ctl.resume(project(current())),

				[`${ns}.push` as const]: (modify: (environment: R) => R) => {
					scopes.push(modify(current()));

					return ctl.resume(undefined);
				},

				[`${ns}.pop` as const]: () => {
					if (scopes.length > 1) {
						scopes.pop();
					}

					return ctl.resume(undefined);
				},
			},

			output: () => undefined,
		};
	};

	return { ask, asks, local, handlers };
}
