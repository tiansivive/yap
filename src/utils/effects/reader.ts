/* eslint-disable no-restricted-syntax */
import { Action, AnyAction, ctl, Eff, Handler } from "@yap/utils/effects/freer";

/*
 * An environment threaded through a computation, replaceable over a subprogram.
 *
 * local is a generator over a push and a pop action rather than a control, so
 * scoping needs nothing from the interpreter. An aborted run leaves its scope
 * unpopped, which costs nothing since the run is over.
 */

export function reader<R>() {
	type Ask = Action<"Reader.ask", undefined, R>;
	type Asks = Action<"Reader.asks", (environment: R) => unknown, unknown>;
	type Push = Action<"Reader.push", (environment: R) => R, undefined>;
	type Pop = Action<"Reader.pop", undefined, undefined>;

	const ask = function* () {
		return yield* ctl.action<Ask>("Reader.ask", undefined);
	};

	/* Generic on the wrapper, so the answer follows the projection per call. */
	const asks = function* <A>(project: (environment: R) => A) {
		return yield* ctl.action<Action<"Reader.asks", (environment: R) => A, A>>("Reader.asks", project);
	};

	const local = function* <Row extends AnyAction, A>(modify: (environment: R) => R, program: Eff<Row, A>) {
		yield* ctl.action<Push>("Reader.push", modify);

		const value = yield* program;

		yield* ctl.action<Pop>("Reader.pop", undefined);

		return value;
	};

	const handlers = (initial: R): Handler<Ask | Asks | Push | Pop, undefined> => {
		/* This handler owns the scopes; its clauses are the only way to move them. */
		const scopes: R[] = [initial];
		const current = () => scopes[scopes.length - 1];

		return {
			clauses: {
				"Reader.ask": () => ctl.resume(current()),
				"Reader.asks": project => ctl.resume(project(current())),

				"Reader.push": modify => {
					scopes.push(modify(current()));

					return ctl.resume(undefined);
				},

				"Reader.pop": () => {
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
