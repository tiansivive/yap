import type * as EB from "@yap/elaboration";

import { Env, Mode, ResidualScope, scope, type EvalMode, type Evaluation, type Machine } from "./effects";
import { schedule } from "./evaluation.v2";
import * as Stack from "./machine/actions";
import type { Unfolding, Value, Closure } from "./syntax/term";
import { Constructors } from "./syntax/term";

export { Env, Mode, ResidualScope } from "./effects";

/**
 * Adds an entry marker, then schedules evaluation on the active machine.
 * The caller provides a result receiver through `drive` or `Do.let` first.
 */
function* evaluate(term: EB.Term): Evaluation<Machine<Value>> {
	yield* Stack.enter(yield* scope());
	return yield* schedule.eval(term);
}

export { evaluate as eval };

/**
 * Adds an entry marker, then schedules quotation on the active machine.
 * The caller provides a result receiver through `drive` or `Do.let` first.
 */
export function* quote(lvl: number, value: Value, unfold?: Unfolding): Evaluation<Machine<EB.Term>> {
	return yield* local(
		{ residualScope: _ => lvl },
		(function* () {
			yield* Stack.enter(yield* scope());
			return yield* schedule.quote(lvl, value, unfold);
		})(),
	);
}

export function* open(binder: EB.Binder, closure: Closure): Evaluation<Machine<Value>> {
	const depth = yield* ResidualScope.ask();

	return yield* local(
		{ residualScope: _ => depth + 1 },
		(function* () {
			yield* Stack.enter(yield* scope());
			return yield* schedule.apply(binder, closure, Constructors.Rigid(depth));
		})(),
	);
}

export function* local<A>(
	changes: {
		env?: (env: EB.Context) => EB.Context;
		mode?: (mode: EvalMode) => EvalMode;
		residualScope?: (depth: number) => number;
	},
	program: Evaluation<A>,
): Evaluation<A> {
	return yield* Env.local(
		changes.env ?? (value => value),
		Mode.local(changes.mode ?? (value => value), ResidualScope.local(changes.residualScope ?? (value => value), program)),
	);
}
