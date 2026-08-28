import type * as NF from "@yap/elaboration/normalization";
import type { IVL } from "../solver/ivl/types";
import type { Verification } from "./effects";

export type VerificationArtefacts = {
	vc: IVL.Formula;
	nf?: NF.Value;
};

export type SynthResult = [NF.Value, VerificationArtefacts];

export type VerificationResult<T = VerificationArtefacts> = Verification<T>;

export type Obligation = {
	label: string;
	expr: IVL.Formula;
	context?: {
		term?: string;
		type?: string;
		description?: string | string[];
	};
};
