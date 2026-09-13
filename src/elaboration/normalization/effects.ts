import * as Eff from "@yap/utils/effects";

import type * as M from "@yap/elaboration/shared/effects";
import type * as Metas from "@yap/elaboration/shared/metas";
import type { Actions } from "./machine/actions";

/* A is what the program answers the machine with, and what its generator hands back once driven. */
export type Evaluation<A> = Eff.Eff<Actions | Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof M.reader> | Eff.Actions<typeof Mode>, A>;

export type EvalMode = {
	/** no δ-reduction: prevents inlining of let-bound definitions. */
	noInlineBindings: boolean;
	/** no ι-reduction: prevents reducing eliminations (projections, matches) on known values. */
	noReduceEliminations: boolean;
};

export const defaultMode: EvalMode = { noInlineBindings: false, noReduceEliminations: false };

export const Mode = Eff.reader<EvalMode, "EvalMode">("EvalMode");
