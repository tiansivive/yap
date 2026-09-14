import * as Eff from "@yap/utils/effects";

import type * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
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

/** What NbE needs handed back with a frame: the environment a term reads under, and the mode it reads in. */
export type Scope = { env: EB.Context; mode: EvalMode };

/** Everything the machine does not provide: the metacontext and the two readers. */
type Ambient = Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof M.reader> | Eff.Actions<typeof Mode>;

/** NbE is the machine instantiated at a scope of env and mode, terms as control, and values as results. */
export type Evaluation<A> = Eff.Eff<Stack.Actions<Scope, EB.Term> | Ambient, A>;

export type Machine<A> = Frames.Machine<A>;

export type StackFrame = Frames.StackFrame<Scope, EB.Term>;

export type Captured = Frames.Captured<Scope, EB.Term>;

export const scope = function* (): Eff.Eff<Ambient, Scope> {
	return { env: yield* M.reader.ask(), mode: yield* Mode.ask() };
};

export const { result, step, group, Do } = notation<Scope, EB.Term, Ambient>(scope);
