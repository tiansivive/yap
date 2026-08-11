import * as NF from "./syntax/term";

import { match } from "ts-pattern";

import { Evaluation } from "./callstack";
import { apply, reduce } from "./evaluation.v2";

export function* unfoldMu(app: Extract<NF.Value, { type: "App" }>): Evaluation<NF.Value | undefined> {
	const { func, arg, icit } = app;

	return yield* match(func)
		.with({ type: "App" }, function* (fn) {
			const inner = yield* unfoldMu(fn);

			if (!inner) {
				return undefined;
			}

			return yield* reduce(inner, arg, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* (mu) {
			const body = yield* apply(mu.binder, mu.closure, mu);

			return yield* reduce(body, arg, icit);
		})
		.otherwise(function* () {
			return undefined;
		});
}
