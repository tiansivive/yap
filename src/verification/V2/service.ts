import * as Eff from "@yap/utils/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";
import type { IVL } from "../solver/ivl/types";
import type { VerificationArtefacts, SynthResult, Obligation } from "./types";
import type { Err } from "./effects";
import { run, type VerificationOptions } from "./effects";
import { check } from "./check";
import { synth } from "./synth";
import { subtype } from "./subtype";

type Outcome<A> = {
	answer: A | Eff.Aborted<Err>;
	obligations: Obligation[];
};

export const VerificationServiceV2 = (options: VerificationOptions = {}) => ({
	check: (tm: EB.Term, ty: NF.Value, ctx: EB.Context, registry: Metas.Registry): Outcome<VerificationArtefacts> => {
		const { answer, obligations } = run(ctx, registry, () => check(tm, ty), options);
		return { answer, obligations };
	},
	synth: (tm: EB.Term, ctx: EB.Context, registry: Metas.Registry): Outcome<SynthResult> => {
		const { answer, obligations } = run(ctx, registry, () => synth(tm), options);
		return { answer, obligations };
	},
	subtype: (left: NF.Value, right: NF.Value, ctx: EB.Context, registry: Metas.Registry): Outcome<IVL.Formula> => {
		const { answer, obligations } = run(ctx, registry, () => subtype(left, right), options);
		return { answer, obligations };
	},
});
