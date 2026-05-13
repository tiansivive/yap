/**
 * Materialization — convert pending foreign/primop results into values.
 *
 * Called by drainAll before passing results to Cont handlers. Positions marked
 * in the Cont's `saturate` set are passed through raw (for App's accumulation
 * logic). Everything else is materialized: saturated foreigns/primops emit their
 * call instruction; partial ones emit a curried closure wrapper chain.
 */

import assert from "node:assert";
import * as MIR from "./mir";
import * as M from "./monad";
import * as C from "./context";

const { Block, Instr, Expr: E, Terminator: T, Function: Fn } = MIR.Constructors;

function* partial(ctx: C.LowerCtx, kind: "foreign" | "primop", nameOrOp: string, arity: number, capturedArgs: C.Stamped[]): M.Glowering<C.Stamped> {
	const remaining = arity - capturedArgs.length;

	const wrappers = Array.from({ length: remaining }, () => ({
		fnName: ctx.nextVar("fn"),
		envParam: ctx.nextVar("env"),
		freshParam: ctx.nextVar(),
	}));

	for (let level = remaining - 1; level >= 0; level--) {
		const w = wrappers[level];
		assert(w);
		const { fnName, envParam, freshParam } = w;
		const numCaptured = capturedArgs.length + level;

		const bodyReads: C.Stamped[] = [];
		const bodyInstrs: MIR.Instr[] = [];
		for (let j = 0; j < numCaptured; j++) {
			const v = ctx.nextVar();
			bodyReads.push(v);
			bodyInstrs.push(Instr.Read(`v${j}`, envParam.name, v.name));
		}
		const allArgs = [...bodyReads, freshParam];

		if (level === remaining - 1) {
			const callResult = ctx.nextVar();
			if (kind === "primop") {
				bodyInstrs.push(
					Instr.Let(
						callResult.name,
						E.PrimOp(
							nameOrOp,
							allArgs.map(a => a.name),
						),
					),
				);
			} else {
				bodyInstrs.push(
					Instr.Call(
						{ type: "direct", func: nameOrOp },
						allArgs.map(a => a.name),
						callResult.name,
					),
				);
			}
			const block = Block(`${fnName.name}_entry`, [], bodyInstrs, T.Return(callResult.name));
			yield* M.Functions.emit(Fn(fnName.name, [envParam.name, freshParam.name], block.label, [block]));
		} else {
			const next = wrappers[level + 1];
			assert(next);
			const newEnvRef = ctx.nextVar("env");
			const newFnRef = ctx.nextVar("fnref");
			const closureRef = ctx.nextVar("closure");
			bodyInstrs.push(
				Instr.Alloc({ type: "Record", fields: allArgs.map((a, i) => ({ label: `v${i}`, value: a.name })) }, newEnvRef.name),
				Instr.Let(newFnRef.name, E.FuncRef(next.fnName.name)),
				Instr.Alloc(
					{
						type: "Record",
						fields: [
							{ label: "__fn", value: newFnRef.name },
							{ label: "__env", value: newEnvRef.name },
						],
					},
					closureRef.name,
				),
			);
			const block = Block(`${fnName.name}_entry`, [], bodyInstrs, T.Return(closureRef.name));
			yield* M.Functions.emit(Fn(fnName.name, [envParam.name, freshParam.name], block.label, [block]));
		}
	}

	const outerWrapper = wrappers[0];
	assert(outerWrapper);
	const envRef = ctx.nextVar("env");
	const fnRef = ctx.nextVar("fnref");
	const closureRef = ctx.nextVar("closure");
	yield* M.Pending.appendMany([
		Instr.Alloc({ type: "Record", fields: capturedArgs.map((a, i) => ({ label: `v${i}`, value: a.name })) }, envRef.name),
		Instr.Let(fnRef.name, E.FuncRef(outerWrapper.fnName.name)),
		Instr.Alloc(
			{
				type: "Record",
				fields: [
					{ label: "__fn", value: fnRef.name },
					{ label: "__env", value: envRef.name },
				],
			},
			closureRef.name,
		),
	]);
	return closureRef;
}

export function* materialize(results: M.LowerResult[], saturate: Set<number>): M.Glowering<M.LowerResult[]> {
	const ctx = yield* M.ask();
	const out: M.LowerResult[] = [];

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		assert(r);
		if (saturate.has(i)) {
			out.push(r);
			continue;
		}
		if (r.tag === "value") {
			out.push(r);
			continue;
		}
		const nameOrOp = r.tag === "foreign" ? r.name : r.op;
		if (r.args.length === r.arity) {
			const result = ctx.nextVar();
			if (r.tag === "primop") {
				yield* M.Pending.append(
					Instr.Let(
						result.name,
						E.PrimOp(
							nameOrOp,
							r.args.map(a => a.name),
						),
					),
				);
			} else {
				yield* M.Pending.append(
					Instr.Call(
						{ type: "direct", func: nameOrOp },
						r.args.map(a => a.name),
						result.name,
					),
				);
			}
			out.push({ tag: "value", value: result });
		} else {
			const closureRef = yield* partial(ctx, r.tag, nameOrOp, r.arity, r.args);
			out.push({ tag: "value", value: closureRef });
		}
	}
	return out;
}
