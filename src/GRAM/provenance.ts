import type { Location } from "@yap/shared/provenance";

export type { Location };

export type PassId = string;

export type Provenance = {
	readonly location?: Location;
	readonly created_by: PassId;
	readonly derived_from?: ReadonlyArray<number>;
};

export const TRANSLATE: PassId = "translate:eb";
export const TRANSLATE_TYPE: PassId = "translate:type";
