import * as Src from "@yap/src/terms";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { Token } from "moo";

export type WithLocation<T> = T & { location: Location };

export type Location = {
	from: LineCol;
	to?: LineCol;
	code?: string;
};

export type LineCol = { line: number; column: number; token?: Token };

export type Traced<T, S> = WithLocation<T> & { provenance: Stack<S> };
export type Stack<T> = Array<T>;

export const provide = <T, S>(value: T, provenance: Traced<T, S>["provenance"], location: Location): Traced<T, S> => ({ ...value, provenance, location });
