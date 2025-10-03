import * as Q from "@yap/shared/modalities/multiplicity";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

type Transform<A, B> = { annotation: A; artefact: B };

export type Modalities = {
	quantity: Transform<Q.Multiplicity, Q.Usages>;
};

export type Annotations = {
	quantity: Q.Multiplicity;
	liquid: NF.Value;
};

export type Artefacts = {
	/** Usage information for each variable in the context */
	usages: Q.Usages;
	/** Verification Condition */
	vc: NF.Value;
};

export const Verification = {
	implication: (p: NF.Value, q: NF.Value): NF.Value => NF.DSL.Binop.or(NF.DSL.Unop.not(p), q),
};
