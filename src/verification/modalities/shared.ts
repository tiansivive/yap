import * as Q from "@yap/shared/modalities/multiplicity";

export type Annotations<T> = {
	quantity: Q.Multiplicity;
	liquid: T;
};
