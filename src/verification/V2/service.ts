import * as Eff from "@yap/utils/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";
import type * as Horn from "../horn";
import type { IVL } from "../solver/ivl/types";
import type { VerificationArtefacts, SynthResult, Obligation } from "./types";
import type { Err } from "./effects";
import { run, type VerificationOptions } from "./effects";
import { binding } from "./check";
import { synth } from "./synth";
import { subtype } from "./subtype";

type Outcome<A> = {
	answer: A | Eff.Aborted<Err>;
	obligations: Obligation[];
	constraints: Horn.Constraint[];
	assignment: IVL.Assignment;
	registry: Metas.Registry;
};

export const VerificationServiceV2 = (options: VerificationOptions = {}) => ({
	check: (tm: EB.Term, ty: NF.Value, ctx: EB.Context, registry: Metas.Registry): Outcome<VerificationArtefacts> => {
		return run(ctx, registry, () => binding(tm, ty), options);
	},
	/* Let bodies retain the self-binder introduced during elaboration. */
	letdec: (variable: string, tm: EB.Term, ty: NF.Value, ctx: EB.Context, registry: Metas.Registry): Outcome<VerificationArtefacts> => {
		return run(EB.bind(ctx, { type: "Let", variable }, ty), registry, () => binding(tm, ty), options);
	},
	synth: (tm: EB.Term, ctx: EB.Context, registry: Metas.Registry): Outcome<SynthResult> => {
		return run(ctx, registry, () => synth(tm), options);
	},
	subtype: (left: NF.Value, right: NF.Value, ctx: EB.Context, registry: Metas.Registry): Outcome<IVL.Formula> => {
		return run(ctx, registry, () => subtype(left, right), options);
	},
});
