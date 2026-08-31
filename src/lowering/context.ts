import type * as EB from "@yap/elaboration";
import type { Block, Declaration, Function, Instr } from "./mir";

/**
 * Worklist frame for stack-based lowering (no recursion).
 * Same explicit-frame pattern as the effect-owned NbE CEK machine; lowering owns a separate worklist.
 */
export type Frame =
	| { type: "Lower"; ctx: LowerCtx; term: EB.Term }
	| { type: "Cont"; arity: number; handler: (results: LowerResult[]) => void }
	| { type: "Delimiter"; resultSize: number };

/** Context when lowering inside a reset. */
export type ResetCtx = {
	resetExit: string;
};

/**
 * Stamped MIR var: `name` is the MIR identifier (used for emission), `stamp` is a unique
 * monotone id used for identity comparison. `nextVar` allocates both atomically.
 *
 * Identity is `stamp === stamp`. Two binders with the same `name` (e.g. across blocks)
 * but different stamps are different values; two binders with the same stamp are the
 * same value (alias case: `let k2 = k` propagates k's stamp to k2's bound entry).
 */
export type Stamped = {
	stamp: number;
	name: string;
};

/**
 * Block builder: the mutable state that lowering accumulates into.
 *
 * - `currentBlock` is the block being filled. Every emission pushes to its instrs.
 *   K-calls and the shift-body terminator "seal" the current block (turn it into a finished
 *   Block, push to closedBlocks) and "install" a fresh currentBlock to continue.
 * - `closedBlocks` accumulates fully-formed blocks produced during the build (s_init, s_1, ...
 *   from k-calls; match decision-tree case blocks; etc.).
 *
 * Spreads of `LowerCtx` preserve the same `BlockBuilder` reference, so all ctxs in the same
 * lowering scope share the builder (mutations are visible everywhere). Lambda / shift / match
 * arm bodies install a *fresh* builder on their inner ctx, so their emissions don't leak into
 * the surrounding scope; after sub-lowering, the closure-captured fresh builder is read to
 * produce the function/branch block.
 */
export type BlockBuilder = {
	currentBlock: { label: string; params: string[]; instrs: Instr[] };
	closedBlocks: Block[];
};

/** Allocate a fresh BlockBuilder rooted at the given entry block. */
export const mkBuilder = (label: string, params: string[] = []): BlockBuilder => ({
	currentBlock: { label, params, instrs: [] },
	closedBlocks: [],
});

/**
 * Context when lowering inside a shift body. Tracks per-shift state independent of the
 * `BlockBuilder` (which carries currentBlock/closedBlocks shared with non-shift lowering).
 */
export type ShiftBodyCtx = {
	rLabel: string;
	kRef: Stamped;
	/** Env in SSA scope of the current block. Updated on block transitions (post-stash). */
	envRef: Stamped;
	/** Counter; increments per k-call in this shift body. */
	nextKCallIdx: number;
	/** Pre-allocated names for each k-call result; re-bound at every block transition so they
	 * stay in scope wherever a primop / consumer references them. */
	kResultNames: Array<{ idx: number; name: string }>;
	resetExit: string;
	/** Captured outer-bound vars, closure-converted into env. Each entry: env field label
	 * (e.g. "v0") + the original Stamped's name (the target the body still references by
	 * name). At every block transition (s_init, each s_i, and r's prefix) we re-read these
	 * from the current env so the captures stay in scope. */
	captures: Array<{ label: string; target: string }>;
	/** Labels of the s_i blocks opened by k-calls, in k-call order. The r block's branch
	 * terminator dispatches to these by index. */
	sLabels: string[];
};

export type LowerCtx = {
	bound: Map<number, Stamped>;
	free: Map<string, Stamped>;
	declarations: Map<string, Declaration>;
	nextVar: (kind?: string) => Stamped;
	nextLabel: (kind?: string) => string;
	/** Block builder; shared by reference across spreads of the same scope. Lambda / shift /
	 * match install a fresh builder for sub-lowering. */
	builder: BlockBuilder;
	/** When inside a reset, carries the exit label. */
	resetCtx?: ResetCtx;
	/** When inside a shift body, for emitting k-calls (split current block + jump to r). */
	shiftBodyCtx?: ShiftBodyCtx;
};

export type LowerResult = {
	value: Stamped;
	functions: Function[];
	/** When present, use these blocks instead of a single block built from instrs.
	 * Used by Match (decision-tree blocks) and Reset/Shift (entry, s_i, r, reset_exit). */
	blocks?: Block[];
	/** When blocks present, label of the entry block. */
	entry?: string;
};

const VAR_PREFIX: Record<string, string> = {
	x: "x",
	fn: "f_",
	fnref: "fnref_",
	closure: "closure_",
	env: "env_",
};

let stampCounter = 0;
const varCounters: Record<string, number> = {};
const labelCounters: Record<string, number> = {};

const nextStamp = (): number => stampCounter++;

const nextVarForKind = (kind: string): Stamped => {
	const prefix = VAR_PREFIX[kind] ?? kind + "_";
	const n = (varCounters[kind] ??= 0);
	varCounters[kind]++;
	return { stamp: nextStamp(), name: `${prefix}${n}` };
};

const nextLabelForKind = (kind: string): string => {
	const n = (labelCounters[kind] ??= 0);
	labelCounters[kind]++;
	return `${kind}${n}`;
};

/** Allocate a Stamped using a caller-provided name (for source-derived binders like Lambda's
 * formal parameter). The name is used directly as the MIR var name; only the stamp is fresh. */
export const stampNamed = (name: string): Stamped => ({ stamp: nextStamp(), name });

export const mkSupply = () => ({
	nextVar: (kind: string = "x") => nextVarForKind(kind),
	/** Allocate a fresh label with the given prefix. Each prefix has its own counter, so
	 * `nextLabel("r")` and `nextLabel()` (default `"b"`) won't collide. */
	nextLabel: (kind: string = "b") => nextLabelForKind(kind),
});

export const resetSupply = () => {
	stampCounter = 0;

	for (const k of Object.keys(varCounters)) {
		delete varCounters[k];
	}
	for (const k of Object.keys(labelCounters)) {
		delete labelCounters[k];
	}
};

export const mkCtx = (opts?: {
	bound?: Array<[number, string]>;
	free?: Array<[string, string]>;
	builder?: BlockBuilder;
	declarations?: Map<string, Declaration>;
}): LowerCtx => {
	const supply = mkSupply();
	const bound = new Map<number, Stamped>(opts?.bound?.map(([idx, name]) => [idx, stampNamed(name)] as const) ?? []);
	const free = new Map<string, Stamped>(opts?.free?.map(([k, name]) => [k, stampNamed(name)] as const) ?? []);
	return {
		bound,
		free,
		declarations: opts?.declarations ?? new Map(),
		builder: opts?.builder ?? mkBuilder("entry"),
		...supply,
	};
};

/** Extend context with a new binder (a Stamped at index 0). Existing indices shift by 1.
 * Overrides applied after shift. */
export const bind = (ctx: LowerCtx, binder: Stamped, overrides?: Map<number, Stamped>): LowerCtx => {
	const shifted = Array.from(ctx.bound.entries()).map(([i, s]) => [i + 1, s] as const);
	const base = new Map<number, Stamped>([[0, binder], ...shifted]);
	const bound = overrides ? new Map([...base, ...overrides]) : base;
	return { ...ctx, bound };
};

/** Extend ctx.bound with column bindings shifted down by 1 (for non-binding match cases like literals). */
export const bindColumns = (ctx: LowerCtx, columns: Map<number, Stamped>): LowerCtx => ({
	...ctx,
	bound: new Map([...ctx.bound, ...[...columns.entries()].map(([col, v]) => [col - 1, v] as const)]),
});

/** Resolve free indices to Stamped via ctx.bound. depth: 0 = indices are 0-based (block scope),
 * 1 = indices are 1-based (lambda body). */
export const resolveCaptured = (ctx: LowerCtx, indices: number[], depth = 1): Stamped[] => {
	const result = indices.map(i => ctx.bound.get(i - depth));
	const bad = result.findIndex(s => s === undefined);

	if (bad >= 0) {
		throw new Error(`Free var index not in bound map: ${indices[bad]! - depth}`);
	}
	return result as Stamped[];
};

/** Safe indexed lookup. Throws if index out of bounds or undefined. */
export const at = <T>(arr: T[], i: number, msg?: string): T => {
	const v = arr[i];

	if (v === undefined) {
		throw new Error(msg ?? `Index ${i} out of bounds`);
	}
	return v;
};
