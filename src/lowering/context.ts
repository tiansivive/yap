import type { Block, Function, Instr, Terminator } from "./mir";
import type { ResetCtx } from "./delimited_continuation/types";

/**
 * Supply (nextVar, nextLabel) is global — passes do NOT reset.
 * lowerToMir does NOT call resetSupply(); callers (e.g. tests) must call it for deterministic names.
 * See docs/ARCHITECTURE.md § Supply and naming.
 */
export type LowerCtx = {
	bound: Map<number, string>;
	free: Map<string, string>;
	nextVar: (kind?: string) => string;
	nextLabel: () => string;
	/** When inside a reset, carries exit label and continuation bindings. */
	resetCtx?: ResetCtx;
};

export type LowerResult = {
	instrs: Instr[];
	value: string;
	functions: Function[];
	/** When present, use these blocks instead of a single block built from instrs. */
	blocks?: Block[];
	/** When blocks present, label of the entry block. */
	entry?: string;
	/** When present, block ends with this terminator instead of Return(value). Used for continuation resume. */
	terminator?: Terminator;
};

const VAR_PREFIX: Record<string, string> = {
	x: "x",
	fn: "f_",
	fnref: "fnref_",
	closure: "closure_",
	env: "env_",
};

let labelCounter = 0;
const varCounters: Record<string, number> = {};

const nextVarForKind = (kind: string): string => {
	const prefix = VAR_PREFIX[kind] ?? kind + "_";
	const n = (varCounters[kind] ??= 0);
	varCounters[kind]++;
	return `${prefix}${n}`;
};

export const mkSupply = () => ({
	nextVar: (kind: string = "x") => nextVarForKind(kind),
	nextLabel: () => `b${labelCounter++}`,
});

export const resetSupply = () => {
	labelCounter = 0;

	for (const k of Object.keys(varCounters)) {
		delete varCounters[k];
	}
};

export const mkCtx = (opts?: { bound?: Array<[number, string]>; free?: Array<[string, string]> }): LowerCtx => {
	const supply = mkSupply();
	return {
		bound: new Map(opts?.bound ?? []),
		free: new Map(opts?.free ?? []),
		...supply,
	};
};

/** Extend context with a new binder (name at index 0). Existing indices shift by 1. Overrides applied after shift. */
export const bind = (ctx: LowerCtx, name: string, overrides?: Map<number, string>): LowerCtx => {
	const shifted = Array.from(ctx.bound.entries()).map(([i, n]) => [i + 1, n] as const);
	const base = new Map<number, string>([[0, name], ...shifted]);
	const bound = overrides ? new Map([...base, ...overrides]) : base;
	return { ...ctx, bound };
};

/** Resolve free indices to names via ctx.bound. depth: 0 = indices are 0-based (block scope), 1 = indices are 1-based (lambda body). */
export const resolveCaptured = (ctx: LowerCtx, indices: number[], depth = 1): string[] => {
	const result = indices.map(i => ctx.bound.get(i - depth));
	const bad = result.findIndex(n => n === undefined);

	if (bad >= 0) {
		throw new Error(`Free var index not in bound map: ${indices[bad]! - depth}`);
	}
	return result as string[];
};

/** Safe indexed lookup. Throws if index out of bounds or undefined. */
export const at = <T>(arr: T[], i: number, msg?: string): T => {
	const v = arr[i];

	if (v === undefined) {
		throw new Error(msg ?? `Index ${i} out of bounds`);
	}
	return v;
};
