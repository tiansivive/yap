import * as Src from "@qtt/src/terms";
import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import { Token } from "moo";

export type WithProvenance<T> = T & { provenance: Provenance };
export type WithLocation<T> = T & { location: Location };

export type Location = {
	from: LineCol;
	to?: LineCol;
	code?: string;
};

export type LineCol = { line: number; column: number; token?: Token };

// Combine into a single tuple type
export type Provenance = {
	location: Location;
	previous?: Provenance;
};
