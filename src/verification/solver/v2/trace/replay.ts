import type * as Encoding from "../encoding";
import type { Event } from "../trace";
import * as Print from "./print";

export const replay = (opts: Options): string => ["=== Formula ===", opts.formula, "", "=== Trace ===", Print.format(opts.steps, opts.encoding)].join("\n");

export type Options = {
	formula: string;
	steps: Event.T[];
	encoding: Encoding.State;
};
