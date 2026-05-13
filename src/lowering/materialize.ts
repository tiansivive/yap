/**
 * Materialization — convert pending foreign/primop results into values.
 *
 * Called by drainAll before passing results to Cont handlers. Positions marked
 * in the Cont's `saturate` set are passed through raw (for App's accumulation
 * logic). Everything else is materialized: saturated foreigns/primops emit their
 * call instruction; partial ones emit a curried closure wrapper chain.
 */

import assert from "node:assert";
import { match } from "ts-pattern";
import * as MIR from "./mir";
import * as M from "./monad";
import * as C from "./context";
import * as Closure from "./closures";

const { Block, Instr, Expr: E, Terminator: T, Function: Fn } = MIR.Constructors;

type Pending = Extract<M.LowerResult, { tag: "foreign" | "primop" }>;
type Wrapper = { fnName: C.Stamped; envParam: C.Stamped; freshParam: C.Stamped };

/* ================================================================================
 * Entry point
 * ================================================================================ */

export function* materialize(results: M.LowerResult[], saturate: Set<number>): M.Glowering<M.LowerResult[]> {
	const ctx = yield* M.ask();
	return yield* M.traverse(results, (r, i) => reify(ctx, r, saturate.has(i)));
}

/* ================================================================================
 * Dispatcher
 * ================================================================================ */

function* reify(ctx: C.LowerCtx, r: M.LowerResult, exempt: boolean): M.Glowering<M.LowerResult> {
	if (exempt) {
		return r;
	}

	if (r.tag === "value") {
		return r;
	}

	if (r.args.length === r.arity) {
		return yield* call(ctx, r);
	}

	const closureRef = yield* partial(ctx, r);
	return { tag: "value", value: closureRef };
}

/* ================================================================================
 * Steps
 * ================================================================================ */

function* call(ctx: C.LowerCtx, r: Pending): M.Glowering<M.LowerResult> {
	const result = ctx.nextVar();
	const argNames = r.args.map(a => a.name);
	const instr = match(r)
		.with({ tag: "primop" }, ({ op }) => Instr.Let(result.name, E.PrimOp(op, argNames)))
		.with({ tag: "foreign" }, ({ name }) => Instr.Call({ type: "direct", func: name }, argNames, result.name))
		.exhaustive();
	yield* M.Pending.append(instr);
	return { tag: "value", value: result };
}

/* ================================================================================
 * Closure wrapper chain for partial application
 * ================================================================================ */

function* partial(ctx: C.LowerCtx, r: Pending): M.Glowering<C.Stamped> {
	const remaining = r.arity - r.args.length;

	const wrappers: Wrapper[] = Array.from({ length: remaining }, () => ({
		fnName: ctx.nextVar("fn"),
		envParam: ctx.nextVar("env"),
		freshParam: ctx.nextVar(),
	}));

	yield* M.traverse(wrappers.toReversed(), function* (w, reverseIdx) {
		const level = remaining - 1 - reverseIdx;
		const numCaptured = r.args.length + level;

		if (level === remaining - 1) {
			return yield* invoke(ctx, w, numCaptured, r);
		}
		const next = wrappers[level + 1];
		assert(next);
		yield* curry(ctx, w, numCaptured, next.fnName.name);
	});

	const outerWrapper = wrappers[0];
	assert(outerWrapper);
	const { instrs, closureRef } = Closure.bundle(ctx, outerWrapper.fnName.name, r.args);
	yield* M.Pending.appendMany(instrs);
	return closureRef;
}

/* ================================================================================
 * Wrapper body generators
 * ================================================================================ */

/** Innermost wrapper — all args collected, emit the actual foreign/primop call. */
function* invoke(ctx: C.LowerCtx, w: Wrapper, numCaptured: number, r: Pending): M.Glowering<void> {
	const { vars, instrs: readInstrs } = unpackEnv(ctx, numCaptured, w.envParam);
	const allArgs = [...vars, w.freshParam];
	const argNames = allArgs.map(a => a.name);
	const callResult = ctx.nextVar();
	const callInstr = match(r)
		.with({ tag: "primop" }, ({ op }) => Instr.Let(callResult.name, E.PrimOp(op, argNames)))
		.with({ tag: "foreign" }, ({ name }) => Instr.Call({ type: "direct", func: name }, argNames, callResult.name))
		.exhaustive();
	const block = Block(`${w.fnName.name}_entry`, [], [...readInstrs, callInstr], T.Return(callResult.name));
	yield* M.Functions.emit(Fn(w.fnName.name, [w.envParam.name, w.freshParam.name], block.label, [block]));
}

/** Intermediate wrapper — capture one more arg, return closure to the next level. */
function* curry(ctx: C.LowerCtx, w: Wrapper, numCaptured: number, nextFnName: string): M.Glowering<void> {
	const { vars, instrs: readInstrs } = unpackEnv(ctx, numCaptured, w.envParam);
	const allArgs = [...vars, w.freshParam];
	const { instrs: bundleInstrs, closureRef } = Closure.bundle(ctx, nextFnName, allArgs);
	const block = Block(`${w.fnName.name}_entry`, [], [...readInstrs, ...bundleInstrs], T.Return(closureRef.name));
	yield* M.Functions.emit(Fn(w.fnName.name, [w.envParam.name, w.freshParam.name], block.label, [block]));
}

/* ================================================================================
 * Pure helpers
 * ================================================================================ */

/** Read captured values out of the environment record. */
const unpackEnv = (ctx: C.LowerCtx, count: number, envParam: C.Stamped) =>
	Array(count)
		.fill(0)
		.reduce<{ vars: C.Stamped[]; instrs: MIR.Instr[] }>(
			(acc, _, j) => {
				const v = ctx.nextVar();
				return {
					vars: [...acc.vars, v],
					instrs: [...acc.instrs, Instr.Read(`v${j}`, envParam.name, v.name)],
				};
			},
			{ vars: [], instrs: [] },
		);
