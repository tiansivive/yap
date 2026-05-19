import type { Graph, NodeId } from "../graph";
import type * as MIR from "../../lowering/mir";

export type Ctx = {
	readonly graph: Graph;
	readonly blocks: ReadonlyArray<MIR.Block>;
	readonly functions: ReadonlyArray<MIR.Function>;
	readonly instrs: ReadonlyArray<MIR.Instr>;
	readonly supply: number;
	readonly names: ReadonlyMap<NodeId, string>;
};

export const fresh = (graph: Graph): Ctx => ({
	graph,
	blocks: [],
	functions: [],
	instrs: [],
	supply: 0,
	names: new Map(),
});

export const name = (ctx: Ctx, prefix = "v"): [string, Ctx] => {
	const n = `${prefix}${ctx.supply}`;
	return [n, { ...ctx, supply: ctx.supply + 1 }];
};

export const bind = (ctx: Ctx, id: NodeId, n: string): Ctx => ({
	...ctx,
	names: new Map([...ctx.names, [id, n]]),
});

export const resolve = (ctx: Ctx, id: NodeId): string | undefined => ctx.names.get(id);

export const instr = (ctx: Ctx, i: MIR.Instr): Ctx => ({
	...ctx,
	instrs: [...ctx.instrs, i],
});

export const block = (ctx: Ctx, b: MIR.Block): Ctx => ({
	...ctx,
	blocks: [...ctx.blocks, b],
});

export const func = (ctx: Ctx, f: MIR.Function): Ctx => ({
	...ctx,
	functions: [...ctx.functions, f],
});

export const fork = (ctx: Ctx): Ctx => ({
	graph: ctx.graph,
	blocks: [],
	functions: [],
	instrs: [],
	supply: ctx.supply,
	names: ctx.names,
});

export const flush = (ctx: Ctx): [ReadonlyArray<MIR.Instr>, Ctx] => [ctx.instrs, { ...ctx, instrs: [] }];
