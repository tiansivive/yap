import * as Eff from "@yap/utils/effects";

import type { Value } from "./syntax/term";
import type * as EB from "@yap/elaboration";
import type * as Metas from "@yap/elaboration/shared/metas";
import type * as Stack from "./machine/actions";
import type * as Frames from "./machine/frames";
import { notation } from "./machine/do";

export type EvalMode = {
	/** no δ-reduction: prevents inlining of let-bound definitions. */
	noInlineBindings: boolean;
	/** no ι-reduction: prevents reducing eliminations (projections, matches) on known values. */
	noReduceEliminations: boolean;
};

export const defaultMode: EvalMode = { noInlineBindings: false, noReduceEliminations: false };

export const Mode = Eff.reader<EvalMode, "EvalMode">("EvalMode");
export const Env = Eff.reader<EB.Context>();

/**
 * We package blocked arguments as existentials to preserve their computations.  
 * Each package adds a result binder but a closure can restore an environment captured
 * before that binder existed. We count the surrounding binders separately in order to
 * assign rigid levels that quote back to the correct variables.
 **/
export const ResidualScope = Eff.reader<number, "ResidualScope">("ResidualScope");

/** Saved with scheduled work so closure lookup and retained binder scope survive independently. */
export type Scope = { env: EB.Context; mode: EvalMode; residualScope: number };

type Ambient = Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof Env> | Eff.Actions<typeof Mode> | Eff.Actions<typeof ResidualScope>;

/** NbE instantiates the machine with its scope, Core terms and operation handlers. */
export type Evaluation<A> = Eff.Eff<Stack.Actions<Scope, EB.Term, Handling> | Ambient, A>;

export type Handling = { identity: { name: string; args: Value[] }; handler: Value };

export type Machine<A> = Frames.Machine<A>;

export type StackFrame = Frames.StackFrame<Scope, EB.Term, Handling>;

export type Captured = Frames.Captured<Scope, EB.Term, Handling>;

export const scope = function* (): Eff.Eff<Ambient, Scope> {
	return { env: yield* Env.ask(), mode: yield* Mode.ask(), residualScope: yield* ResidualScope.ask() };
};

export const { result, step, group, Do } = notation<Scope, EB.Term, Ambient, Handling>(scope);

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
