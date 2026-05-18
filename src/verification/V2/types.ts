import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";
import type * as V2 from "@yap/elaboration/shared/monad.v2";
import type { IVL } from "../solver/ivl";

export type VerificationArtefacts = {
	vc: IVL.Formula;
	nf?: NF.Value;
};

export type CheckFn = ((term: EB.Term, type: NF.Value) => VerificationResult) & {
	gen: (term: EB.Term, type: NF.Value) => VerificationResult;
};

export type SynthResult = [NF.Value, VerificationArtefacts];
export type SynthFn = ((term: EB.Term) => VerificationResult<SynthResult>) & {
	gen: (term: EB.Term) => VerificationResult<SynthResult>;
};

export type SubtypeFn = ((left: NF.Value, right: NF.Value) => VerificationResult<IVL.Formula>) & {
	gen: (left: NF.Value, right: NF.Value) => VerificationResult<IVL.Formula>;
};

export type VerificationResult<T = VerificationArtefacts> = V2.Elaboration<T>;

export type VerificationServiceOptions = {
	logging?: boolean;
};

export type VerificationServiceAPI = {
	check: CheckFn;
	synth: SynthFn;
	subtype: SubtypeFn;
	getObligations: () => Obligation[];
};

export type Obligation = {
	label: string;
	expr: IVL.Formula;
	context?: {
		term?: string;
		type?: string;
		description?: string | string[];
	};
};

export type VerificationServiceFactory = (options?: VerificationServiceOptions) => VerificationServiceAPI;
