import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";
import * as Bundle from "./bundle";
import { ARITIES } from "../../lowering/shared/primops";

const { Terminator, Block, Function: Fn, Instr, Expr } = Constructors;

export const pap = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const node = Nodes.get(id)(ctx.graph);

	if (node === undefined) {
		return C.name(ctx);
	}

	const remaining = (node.payload.remaining ?? 0) as number;

	const extEdge = Edges.one(id, Labels.MATERIALIZES)(ctx.graph);

	if (extEdge === undefined) {
		return C.name(ctx);
	}

	const ext = Nodes.get(extEdge.target)(ctx.graph);

	if (ext === undefined) {
		return C.name(ctx);
	}

	const callee = (ext.payload.name ?? "") as string;
	const arity = (ext.payload.arity ?? 0) as number;
	const isPrimop = ARITIES[callee] !== undefined;

	const capturedEdges = Edges.byLabel(
		id,
		Labels.CAPTURED,
	)(ctx.graph)
		.slice()
		.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0));

	const [capturedNames, c1] = capturedEdges.reduce<[ReadonlyArray<string>, Ctx]>(
		([acc, c], edge) => {
			const [n, c2] = walk(edge.target, c);
			return [[...acc, n], c2];
		},
		[[], ctx],
	);

	const wrappers = buildWrappers(remaining, c1);
	const c2 = emitWrapperFunctions(callee, arity, capturedNames.length, remaining, isPrimop, wrappers, c1);

	return Bundle.emitAtSite(wrappers[0]?.fnName ?? "pap_fn", capturedNames, c2);
};

type Wrapper = { readonly fnName: string; readonly envParam: string; readonly freshParam: string };

const buildWrappers = (remaining: number, ctx: Ctx): ReadonlyArray<Wrapper> => {
	let supply = ctx.supply;
	return Array.from({ length: remaining }, () => {
		const fnName = `pap_fn${supply++}`;
		const envParam = `env${supply++}`;
		const freshParam = `arg${supply++}`;
		return { fnName, envParam, freshParam };
	});
};

const emitWrapperFunctions = (
	callee: string,
	arity: number,
	capturedCount: number,
	remaining: number,
	isPrimop: boolean,
	wrappers: ReadonlyArray<Wrapper>,
	ctx: Ctx,
): Ctx =>
	wrappers.reduceRight((c, w, i) => {
		const level = i;
		const numCaptured = capturedCount + level;
		const isInnermost = level === remaining - 1;

		const fn = isInnermost ? buildInvokeWrapper(callee, arity, w, numCaptured, isPrimop) : buildCurryWrapper(w, numCaptured, wrappers[level + 1].fnName);

		return C.func(c, fn);
	}, ctx);

const buildInvokeWrapper = (callee: string, arity: number, w: Wrapper, numCaptured: number, isPrimop: boolean): MIR.Function => {
	const reads = Bundle.unpackEnv(numCaptured, w.envParam);
	const allArgs = [...reads.vars, w.freshParam];
	const result = `result_${w.fnName}`;

	const callInstr = isPrimop ? Instr.Let(result, Expr.PrimOp(callee, allArgs)) : Instr.Call({ type: "direct", func: callee }, allArgs, result);

	const block = Block(`${w.fnName}_entry`, [], [...reads.instrs, callInstr], Terminator.Return(result));

	return Fn(w.fnName, [w.envParam, w.freshParam], block.label, [block]);
};

const buildCurryWrapper = (w: Wrapper, numCaptured: number, nextFnName: string): MIR.Function => {
	const reads = Bundle.unpackEnv(numCaptured, w.envParam);
	const allArgs = [...reads.vars, w.freshParam];

	const bundle = Bundle.bundleClosure(nextFnName, allArgs, w.fnName);

	const block = Block(`${w.fnName}_entry`, [], [...reads.instrs, ...bundle.instrs], Terminator.Return(bundle.closureRef));

	return Fn(w.fnName, [w.envParam, w.freshParam], block.label, [block]);
};
