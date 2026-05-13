/**
 * RWSE monad for the lowering pass.
 *
 * Mirrors `src/elaboration/shared/monad.v2.ts` in shape. Specific to lowering:
 * - Reader = `LowerCtx` (bound, free, resetCtx?, shiftBodyCtx?).
 * - Writer = `{ blocks: MIR.Block[]; functions: MIR.Function[] }` — finalized output that grows
 *   monotonically as we seal blocks and lift lambda bodies.
 * - State  = `{ worklist; results; focus; accumulated }` — the explicit-stack machinery
 *   (worklist + results) plus the pending-block bookkeeping (focus + accumulated).
 * - Error  = a lowering-specific `Cause` ADT; no provenance for now.
 *
 * Supply (`nextVar`, `nextLabel`, `nextStamp`) lives outside the monad as module-level
 * counters in `context.ts`. That matches what elaboration does for similar fresh-name
 * generation. Deliberately not threaded through State.
 */

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import type * as EB from "@yap/elaboration";
import type * as MIR from "./mir";
import type { LowerCtx, Stamped } from "./context";

/** Shorthand for the global JS Error constructor (the local `Error` namespace shadows it). */
namespace JS {
	export const Error = globalThis.Error;
}

/* ================================================================================
 * Types
 * ================================================================================ */

export type BlockLabel = string;

export type Pending = {
	label: BlockLabel;
	params: string[];
	instrs: MIR.Instr[];
};

export type LowerResult =
	| { tag: "value"; value: Stamped }
	| { tag: "foreign"; name: string; arity: number; args: Stamped[] }
	| { tag: "primop"; op: string; arity: number; args: Stamped[] };

export type ValueResult = Extract<LowerResult, { tag: "value" }>;

// NOTE: arity-0 Conts are effectively sequencing-only side effects (e.g. open a block).
// They don't consume results — they just need to fire at a specific drain position.
// A dedicated `Effect` frame variant could make this intent explicit and open the door
// to richer worklist semantics: selective capture during shift (ambient vs local effects),
// interception/handling (algebraic-effect-style), and observability. For now arity-0 Cont
// is sufficient; revisit if capture semantics or effect management become relevant.
export type Frame =
	| { type: "Lower"; ctx: LowerCtx; term: EB.Term }
	| { type: "Cont"; arity: number; handler: (results: ValueResult[]) => Lowering<void> }
	| {
			type: "Cont:sat";
			arity: number;
			/** Positions in the results array that participate in foreign/primop saturation.
			 * These positions are NOT auto-materialized by drainAll — the handler receives the
			 * raw LowerResult (which may be a pending foreign/primop) and is responsible for
			 * accumulation logic. All other positions are materialized before reaching the handler. */
			saturate: Set<number>;
			handler: (results: LowerResult[]) => Lowering<void>;
	  }
	| { type: "Delimiter"; resultSize: number };

export type Cause =
	| { tag: "ShiftWithoutReset" }
	| { tag: "InvalidShiftBody"; got: string }
	| { tag: "UnboundBoundIndex"; index: number }
	| { tag: "UnboundFreeName"; name: string }
	| { tag: "UnboundForeignName"; name: string }
	| { tag: "PrimitiveAsValue"; name: string }
	| { tag: "TypeLevelInValuePosition" }
	| { tag: "NotImplemented"; what: string };

export type Err = { cause: Cause; ctx: LowerCtx };

export type Accumulator = {
	blocks: MIR.Block[];
	functions: MIR.Function[];
};

export type State = {
	worklist: Frame[];
	results: LowerResult[];
	focus: BlockLabel | undefined;
	accumulated: Map<BlockLabel, Pending>;
};

export type Collector<A> = Accumulator & { result: Either<Err, A> };

export type Lowering<A> = (ctx: LowerCtx, w?: Accumulator, st?: State) => [Collector<A>, State];
export type Glowering<A> = Generator<Lowering<any>, A, any>;

/* ================================================================================
 * Internal helpers (not exported)
 * ================================================================================ */

const emptyAcc: Accumulator = { blocks: [], functions: [] };

const concat = (a: Accumulator, b: Accumulator): Accumulator => ({
	blocks: a.blocks.concat(b.blocks),
	functions: a.functions.concat(b.functions),
});

const mkCollector = <A>(a: A): Collector<A> => ({ ...emptyAcc, result: E.right(a) });

const mkErr = <A>(err: Err): Collector<A> => ({ ...emptyAcc, result: E.left(err) });

/* ================================================================================
 * State (type + namespace)
 * ================================================================================ */

export namespace State {
	export const initial: State = {
		worklist: [],
		results: [],
		focus: undefined,
		accumulated: new Map(),
	};

	export const get = function* (): Glowering<State> {
		return yield (_ctx, _w, st = initial) => [mkCollector(st), st];
	};

	export const put = function* (s: State): Glowering<void> {
		yield (_ctx, _w, _st) => [mkCollector(undefined as void), s];
	};

	export const modify = function* (f: (s: State) => State): Glowering<void> {
		yield (_ctx, _w, st = initial) => [mkCollector(undefined as void), f(st)];
	};
}

/* ================================================================================
 * Pure / Do / lifting
 * ================================================================================ */

export const of =
	<A>(a: A): Lowering<A> =>
	(_ctx, _w, st = State.initial) => [mkCollector(a), st];

export const pure = function* <A>(ma: Lowering<A>): Glowering<A> {
	const a: A = yield ma;
	return a;
};

export const lift = function* <A>(a: A): Glowering<A> {
	return yield (_c, _w, st = State.initial) => [mkCollector(a), st];
};

export const liftC = function* <A>(c: Collector<A>): Glowering<A> {
	return yield (_c, _w, st = State.initial) => [c, st];
};

export const liftE = <A>(e: Either<Err, A>): Glowering<A> => {
	return liftC({ ...emptyAcc, result: e });
};

export function Do<R>(gen: () => Generator<Lowering<any>, R, any>): Lowering<R> {
	return (ctx, _w, initialSt = State.initial) => {
		const it = gen();
		let collected: Accumulator = emptyAcc;
		let mutableState: State = initialSt;
		let step = it.next();

		while (!step.done) {
			const [ma, st] = step.value(ctx, collected, mutableState);
			collected = concat(collected, ma);
			mutableState = st;

			if (E.isLeft(ma.result)) {
				return [{ ...collected, result: ma.result }, mutableState];
			}
			step = it.next(ma.result.right);
		}
		return [{ ...collected, result: E.right(step.value) }, mutableState];
	};
}

/* ================================================================================
 * Reader
 * ================================================================================ */

export namespace Reader {
	export const ask = function* (): Glowering<LowerCtx> {
		return yield (ctx, _w, st = State.initial) => [mkCollector(ctx), st];
	};

	export const asks = function* <A>(f: (ctx: LowerCtx) => A): Glowering<A> {
		return yield (ctx, _w, st = State.initial) => [mkCollector(f(ctx)), st];
	};

	export function local<A>(modify: (ctx: LowerCtx) => LowerCtx, ma: Lowering<A>): Glowering<A> {
		return (function* (): Glowering<A> {
			const a: A = yield (ctx: LowerCtx, w, st = State.initial) => ma(modify(ctx), w, st);
			return a;
		})();
	}
}

/* ================================================================================
 * Writer — two channels: Blocks and Functions
 * ================================================================================ */

export namespace Blocks {
	export const emit = function* (block: MIR.Block): Glowering<void> {
		yield (_ctx, _w, st = State.initial) => [{ blocks: [block], functions: [], result: E.right(undefined as void) }, st];
	};

	export const emitMany = function* (blocks: MIR.Block[]): Glowering<void> {
		if (blocks.length === 0) {
			return;
		}
		yield (_ctx, _w, st = State.initial) => [{ blocks, functions: [], result: E.right(undefined as void) }, st];
	};
}

export namespace Functions {
	export const emit = function* (fn: MIR.Function): Glowering<void> {
		yield (_ctx, _w, st = State.initial) => [{ blocks: [], functions: [fn], result: E.right(undefined as void) }, st];
	};

	export const emitMany = function* (fns: MIR.Function[]): Glowering<void> {
		if (fns.length === 0) {
			return;
		}
		yield (_ctx, _w, st = State.initial) => [{ blocks: [], functions: fns, result: E.right(undefined as void) }, st];
	};
}

/* ================================================================================
 * Error
 * ================================================================================ */

export namespace Error {
	export const fail = function* <A>(cause: Cause): Glowering<A> {
		const ctx = yield* Reader.ask();
		return yield* liftE<A>(E.left({ cause, ctx }));
	};
}

export const display = ({ cause: c }: Err): string => {
	switch (c.tag) {
		case "ShiftWithoutReset":
			return "shift without enclosing reset";
		case "InvalidShiftBody":
			return `shift body must be Lambda(k, e), got ${c.got}`;
		case "UnboundBoundIndex":
			return `unbound de Bruijn index ${c.index}`;
		case "UnboundFreeName":
			return `unbound free variable: ${c.name}`;
		case "UnboundForeignName":
			return `unbound foreign: ${c.name}`;
		case "PrimitiveAsValue":
			return `primitive ${c.name} used as value (not implemented)`;
		case "TypeLevelInValuePosition":
			return "type-level term in value position";
		case "NotImplemented":
			return `not implemented: ${c.what}`;
	}
};

/* ================================================================================
 * State — Worklist
 * ================================================================================ */

export namespace Worklist {
	export const push = function* (frame: Frame): Glowering<void> {
		yield* State.modify(s => ({ ...s, worklist: s.worklist.concat([frame]) }));
	};

	export const pushMany = function* (frames: Frame[]): Glowering<void> {
		if (frames.length === 0) {
			return;
		}
		yield* State.modify(s => ({ ...s, worklist: s.worklist.concat(frames) }));
	};

	export const pop = function* (): Glowering<Frame | undefined> {
		const s = yield* State.get();

		if (s.worklist.length === 0) {
			return undefined;
		}
		const frame = s.worklist[s.worklist.length - 1]!;
		yield* State.put({ ...s, worklist: s.worklist.slice(0, -1) });
		return frame;
	};

	export const peek = function* (): Glowering<Frame | undefined> {
		const s = yield* State.get();
		return s.worklist[s.worklist.length - 1];
	};
}

/* ================================================================================
 * State — Results
 * ================================================================================ */

export namespace Results {
	export const push = function* (r: LowerResult): Glowering<void> {
		yield* State.modify(s => ({ ...s, results: s.results.concat([r]) }));
	};

	export const pop = function* (arity: number): Glowering<LowerResult[]> {
		const s = yield* State.get();
		if (s.results.length < arity) {
			throw new JS.Error(`Results.pop invariant: need ${arity}, have ${s.results.length}`);
		}
		const popped = s.results.slice(-arity);
		yield* State.put({ ...s, results: s.results.slice(0, -arity) });
		return popped;
	};
}

/* ================================================================================
 * State — Focus
 * ================================================================================ */

export namespace Focus {
	export const get = function* (): Glowering<BlockLabel | undefined> {
		const s = yield* State.get();
		return s.focus;
	};

	export const set = function* (label: BlockLabel | undefined): Glowering<void> {
		yield* State.modify(s => ({ ...s, focus: label }));
	};
}

/* ================================================================================
 * State — Pending blocks (label -> in-flight instr buffer)
 *
 * Pending blocks are "in-flight" — label, params, and accumulated instrs, no terminator
 * yet. They graduate to the Writer's `blocks` accumulator via `Pending.finalize`. Labels
 * must be unique across pending blocks (use `ctx.nextLabel()` to allocate).
 * ================================================================================ */

export namespace Pending {
	/** Add a new pending block and make it the current focus. */
	export const open = function* (label: BlockLabel, params: string[], initial: MIR.Instr[] = []): Glowering<void> {
		yield* State.modify(s => {
			const accumulated = new Map(s.accumulated);
			accumulated.set(label, { label, params, instrs: initial });
			return { ...s, accumulated, focus: label };
		});
	};

	/** Append an instruction to the currently-focused pending block. */
	export const append = function* (instr: MIR.Instr): Glowering<void> {
		const s = yield* State.get();
		if (s.focus === undefined) {
			throw new JS.Error("Pending.append invariant: no focus set");
		}
		const cur = s.accumulated.get(s.focus);
		if (!cur) {
			throw new JS.Error(`Pending.append invariant: no pending block for focus ${s.focus}`);
		}
		const accumulated = new Map(s.accumulated);
		accumulated.set(s.focus, { ...cur, instrs: cur.instrs.concat([instr]) });
		yield* State.put({ ...s, accumulated });
	};

	/** Append several instructions to the currently-focused pending block. */
	export const appendMany = function* (instrs: MIR.Instr[]): Glowering<void> {
		if (instrs.length === 0) {
			return;
		}
		const s = yield* State.get();
		if (s.focus === undefined) {
			throw new JS.Error("Pending.appendMany invariant: no focus set");
		}
		const cur = s.accumulated.get(s.focus);
		if (!cur) {
			throw new JS.Error(`Pending.appendMany invariant: no pending block for focus ${s.focus}`);
		}
		const accumulated = new Map(s.accumulated);
		accumulated.set(s.focus, { ...cur, instrs: cur.instrs.concat(instrs) });
		yield* State.put({ ...s, accumulated });
	};

	/** Read a specific pending block. */
	export const peek = function* (label: BlockLabel): Glowering<Pending | undefined> {
		const s = yield* State.get();
		return s.accumulated.get(label);
	};

	/** Prepend instructions to the front of `label`'s pending block. */
	export const prepend = function* (instrs: MIR.Instr[]): Glowering<void> {
		if (instrs.length === 0) {
			return;
		}
		const s = yield* State.get();

		if (s.focus === undefined) {
			throw new JS.Error("Pending.prepend invariant: no focus set");
		}
		const cur = s.accumulated.get(s.focus);
		if (!cur) {
			throw new JS.Error(`Pending.prepend invariant: no pending block for focus ${s.focus}`);
		}
		const accumulated = new Map(s.accumulated);
		accumulated.set(s.focus, { ...cur, instrs: instrs.concat(cur.instrs) });
		yield* State.put({ ...s, accumulated });
	};

	/**
	 * Seal a pending block with `terminator` and emit it to the Writer (`Blocks`).
	 * Removes the pending entry. If it was the focus, focus becomes undefined.
	 */
	export const finalize = function* (label: BlockLabel, terminator: MIR.Terminator): Glowering<void> {
		const s = yield* State.get();
		const pending = s.accumulated.get(label);
		if (!pending) {
			throw new JS.Error(`Pending.finalize invariant: no pending block for ${label}`);
		}
		const block: MIR.Block = {
			label: pending.label,
			params: pending.params,
			instrs: pending.instrs,
			terminator,
		};
		const accumulated = new Map(s.accumulated);
		accumulated.delete(label);
		const focus = s.focus === label ? undefined : s.focus;
		yield* State.put({ ...s, accumulated, focus });
		yield* Blocks.emit(block);
	};
}

/* ================================================================================
 * Top-level aliases for the common non-conflicting members
 * ================================================================================ */

export const ask = Reader.ask;
export const asks = Reader.asks;
export const local = Reader.local;
export const fail = Error.fail;

/* ================================================================================
 * Run
 * ================================================================================ */

export function run<A>(ma: Lowering<A>, ctx: LowerCtx, st: State = State.initial): [Collector<A>, State] {
	return ma(ctx, emptyAcc, st);
}

type Test = { tag: "foo"; x: number; fn: (s: string) => number } | { tag: "foo:sat"; fn: (n: number) => string };

const t: Test = { tag: "foo:sat", fn: n => "hello" };
