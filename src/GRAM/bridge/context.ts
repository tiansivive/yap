import type { Graph, NodeId } from "../graph";
import { Query } from "../graph";
import type * as MIR from "../../lowering/mir";
import { Constructors } from "../../lowering/mir";
import { demand } from "./demand";

export type Ctx = {
	readonly graph: Graph;
	readonly blocks: ReadonlyArray<MIR.Block>;
	readonly functions: ReadonlyArray<MIR.Function>;
	readonly instrs: ReadonlyArray<MIR.Instr>;
	readonly supply: number;
	readonly names: ReadonlyMap<NodeId, string>;
	readonly labels: ReadonlyMap<string, string>;
	readonly label: string;
	readonly params: ReadonlyArray<string>;
	readonly returns: ReadonlyMap<NodeId, ReadonlyArray<MIR.Case>>;
	readonly demand: ReadonlySet<NodeId>;
};

export const fresh = (graph: Graph): Ctx => ({
	graph,
	blocks: [],
	functions: [],
	instrs: [],
	supply: 0,
	names: new Map(),
	labels: new Map(),
	label: "entry",
	params: [],
	returns: new Map(),
	demand: demand(graph),
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

export const bound = (ctx: Ctx, id: NodeId): string => {
	const value = resolve(ctx, id);
	if (value === undefined) {
		throw new Error(`GRAM bridge: unavailable binding ${id}`);
	}
	return value;
};

export const target = (ctx: Ctx, id: NodeId, label: string): NodeId => {
	const value = Query.follow(id, label)(ctx.graph);
	if (value === undefined) {
		throw new Error(`GRAM bridge: ${id} requires ${label}`);
	}
	return value;
};

export const bindLabel = (ctx: Ctx, label: string, n: string): Ctx => ({
	...ctx,
	labels: new Map([...ctx.labels, [label, n]]),
});

export const resolveLabel = (ctx: Ctx, label: string): string | undefined => ctx.labels.get(label);

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
	...ctx,
	blocks: [],
	functions: [],
	instrs: [],
	supply: ctx.supply,
	names: ctx.names,
	labels: ctx.labels,
	label: "entry",
	params: [],
	returns: new Map(),
});

export const open = (ctx: Ctx, label: string, params: ReadonlyArray<string> = []): Ctx => ({ ...ctx, label, params, instrs: [] });

export const close = (ctx: Ctx, terminator: MIR.Terminator): Ctx =>
	block({ ...ctx, instrs: [] }, Constructors.Block(ctx.label, [...ctx.params], [...ctx.instrs], terminator));

export const flush = (ctx: Ctx): [ReadonlyArray<MIR.Instr>, Ctx] => [ctx.instrs, { ...ctx, instrs: [] }];
