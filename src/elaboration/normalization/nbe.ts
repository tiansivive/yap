import type * as EB from "@yap/elaboration";

import { scope, type Evaluation, type Machine } from "./effects";
import { schedule } from "./evaluation.v2";
import * as Stack from "./machine/actions";
import type { Unfolding, Value } from "./syntax/term";

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
	yield* Stack.enter(yield* scope());
	return yield* schedule.quote(lvl, value, unfold);
}
