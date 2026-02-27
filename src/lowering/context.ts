import type { Function, Instr } from "./mir";

/**
 * Supply (nextVar, nextLabel, nextFuncName) is global — passes do NOT reset.
 * lowerToMir does NOT call resetSupply(); callers (e.g. tests) call it for deterministic names.
 * See docs/ARCHITECTURE.md § Supply and naming.
 */
export type LowerCtx = {
	bound: Map<number, string>;
	free: Map<string, string>;
	nextVar: () => string;
	nextLabel: () => string;
	nextFuncName: () => string;
};

export type LowerResult = {
	instrs: Instr[];
	value: string;
	functions: Function[];
};

let varCounter = 0;
let labelCounter = 0;
let funcCounter = 0;

export const mkSupply = () => ({
	nextVar: () => `x${varCounter++}`,
	nextLabel: () => `b${labelCounter++}`,
	nextFuncName: () => `f_${funcCounter++}`,
});

export const resetSupply = () => {
	varCounter = 0;
	labelCounter = 0;
	funcCounter = 0;
};

export const mkCtx = (opts?: { bound?: Array<[number, string]>; free?: Array<[string, string]> }): LowerCtx => {
	const supply = mkSupply();
	return {
		bound: new Map(opts?.bound ?? []),
		free: new Map(opts?.free ?? []),
		...supply,
	};
};
