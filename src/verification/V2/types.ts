import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";
import type * as V2 from "@yap/elaboration/shared/monad.v2";
import type { Expr, Context as Z3Context } from "z3-solver";

export type VerificationArtefacts = {
	vc: Expr;
};

export type CheckFn = ((term: EB.Term, type: NF.Value) => VerificationResult) & {
	gen: (term: EB.Term, type: NF.Value) => VerificationResult;
};

export type SynthResult = [NF.Value, VerificationArtefacts];
export type SynthFn = ((term: EB.Term) => VerificationResult<SynthResult>) & {
	gen: (term: EB.Term) => VerificationResult<SynthResult>;
};

export type SubtypeFn = ((left: NF.Value, right: NF.Value) => VerificationResult<Expr>) & {
	gen: (left: NF.Value, right: NF.Value) => VerificationResult<Expr>;
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
	expr: Expr;
	context?: {
		term?: string;
		type?: string;
		description?: string | string[];
	};
};

export type VerificationServiceFactory = (Z3: Z3Context<"main">, options?: VerificationServiceOptions) => VerificationServiceAPI;
