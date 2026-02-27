import type { Instr } from "./mir";

/**
 * Supply (nextVar, nextLabel, nextFuncName) is global — passes do NOT reset.
 * See docs/ARCHITECTURE.md § Supply and naming.
 */
export type LowerCtx = {
	bound: Map<number, string>;
	free: Map<string, string>;
	nextVar: () => string;
	nextLabel: () => string;
};

export type LowerResult = {
	instrs: Instr[];
	value: string;
};

let varCounter = 0;
let labelCounter = 0;

export const mkSupply = () => ({
	nextVar: () => `x${varCounter++}`,
	nextLabel: () => `b${labelCounter++}`,
});

export const resetSupply = () => {
	varCounter = 0;
	labelCounter = 0;
};

export const mkCtx = (opts?: { bound?: Array<[number, string]>; free?: Array<[string, string]> }): LowerCtx => {
	const supply = mkSupply();
	return {
		bound: new Map(opts?.bound ?? []),
		free: new Map(opts?.free ?? []),
		...supply,
	};
};
