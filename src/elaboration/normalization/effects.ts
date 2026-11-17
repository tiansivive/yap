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
export const Level = Eff.reader<number, "EvalLevel">("EvalLevel");

/** Saved with scheduled work so closure lookup and retained binder scope survive independently. */
export type Scope = { env: EB.Context; mode: EvalMode; level: number };

type Ambient = Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof Env> | Eff.Actions<typeof Mode> | Eff.Actions<typeof Level>;

/** NbE instantiates the machine with its scope, Core terms and operation handlers. */
export type Evaluation<A> = Eff.Eff<Stack.Actions<Scope, EB.Term, Handling> | Ambient, A>;

export type Handling = { identity: { name: string; args: Value[] }; handler: Value };

export type Machine<A> = Frames.Machine<A>;

export type StackFrame = Frames.StackFrame<Scope, EB.Term, Handling>;

export type Captured = Frames.Captured<Scope, EB.Term, Handling>;

export const scope = function* (): Eff.Eff<Ambient, Scope> {
	return { env: yield* Env.ask(), mode: yield* Mode.ask(), level: yield* Level.ask() };
};

export const { result, step, group, Do } = notation<Scope, EB.Term, Ambient, Handling>(scope);
