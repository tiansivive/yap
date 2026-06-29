import { match } from "ts-pattern";

import { Nodes, Edges, entry } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";
import * as Leaves from "./leaves";
import * as Structural from "./structural";
import * as Blocks from "./blocks";
import * as Closures from "./closures";
import * as Primops from "./primops";
import * as Paps from "./pap";
import * as Decisions from "./decisions";
import * as Continuations from "./continuations";

const { Terminator, Block, Function: Fn, Module } = Constructors;

export const emit = (graph: Graph): MIR.Module => {
	const root = entry(graph);
	const ctx = C.fresh(graph);
	const [result, final] = root !== undefined ? walk(root, ctx) : C.name(ctx);
	const [instrs, flushed] = C.flush(final);
	const entryBlock =
		flushed.blocks.length > 0
			? Block("entry", [], [...instrs], Terminator.Jump(flushed.blocks[0].label, []))
			: Block("entry", [], [...instrs], Terminator.Return(result));
	const main = Fn("main", [], "entry", [entryBlock, ...flushed.blocks]);
	return Module([main, ...flushed.functions]);
};

const walk = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const existing = C.resolve(ctx, id);
	return existing !== undefined ? [existing, ctx] : dispatch(id, ctx);
};

const dispatch = (id: NodeId, ctx: Ctx): [string, Ctx] =>
	match(Nodes.get(id)(ctx.graph)?.tag)
		.with(Tags.LIT, () => Leaves.lit(id, ctx))
		.with(Tags.VAR_BOUND, () => Leaves.bound(id, ctx))
		.with(Tags.VAR_REF, () => ref(id, ctx))
		.with(Tags.VAR_FREE, () => Leaves.free(id, ctx))
		.with(Tags.VAR_FOREIGN, () => Leaves.foreign(id, ctx))
		.with(Tags.VAR_LABEL, () => Leaves.label(id, ctx))
		.with(Tags.VAR_META, () => emptyStruct(ctx))
		.with(Tags.PI, () => emptyStruct(ctx))
		.with(Tags.SIGMA, () => emptyStruct(ctx))
		.with(Tags.PROJ, () => Structural.read(id, walk, ctx))
		.with(Tags.INJ, () => Structural.update(id, walk, ctx))
		.with(Tags.APP, () => app(id, ctx))
		.with(Tags.BLOCK, () => Blocks.lower(id, walk, ctx))
		.with(Tags.LET, () => letNode(id, ctx))
		.with(Tags.CLOSURE, () => Closures.closure(id, walk, ctx))
		.with(Tags.LAMBDA, () => lambda(id, ctx))
		.with(Tags.PRIMOP, () => Primops.primop(id, walk, ctx))
		.with(Tags.EXTERNAL, () => Primops.external(id, walk, ctx))
		.with(Tags.PAP, () => Paps.pap(id, walk, ctx))
		.with(Tags.MATCH, () => Decisions.decision(id, walk, ctx))
		.with(Tags.RESET, () => Continuations.reset(id, walk, ctx))
		.with(Tags.RESUMPTION, () => Continuations.resume(id, walk, ctx))
		.with(Tags.BUBBLE, () => Leaves.passthrough(id, ctx))
		.with(Tags.ROW_EXT, () => struct(id, ctx))
		.with(Tags.ROW_EMPTY, () => emptyStruct(ctx))
		.otherwise(() => Leaves.passthrough(id, ctx));

// Lambda: check if it has a closure wrapping it; if so emit the closure
const lambda = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const closureEdge = Edges.to(id)(ctx.graph).find(e => e.label === Labels.BODY && Nodes.get(e.source)(ctx.graph)?.tag === Tags.CLOSURE);
	return closureEdge !== undefined ? Closures.closure(closureEdge.source, walk, ctx) : Leaves.passthrough(id, ctx);
};

// VAR_REF nodes dereference through :refers_to
const ref = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const target = Edges.one(id, Labels.REFERS_TO)(ctx.graph)?.target;
	return target !== undefined ? walk(target, ctx) : Leaves.passthrough(id, ctx);
};

// App dispatches: struct constructor (App(Lit("Struct"), Row)) vs generic application
const app = (id: NodeId, ctx: Ctx): [string, Ctx] => (isStructApp(id, ctx) ? structFromApp(id, ctx) : application(id, ctx));

const isStructApp = (id: NodeId, ctx: Ctx): boolean => {
	const funcTarget = Edges.one(id, Labels.FUNC)(ctx.graph)?.target;
	const funcNode = funcTarget !== undefined ? Nodes.get(funcTarget)(ctx.graph) : undefined;
	return funcNode?.tag === Tags.LIT && (funcNode.payload.value as { type?: string })?.type === "Atom";
};

const structFromApp = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const argEdge = Edges.one(id, Labels.ARG)(ctx.graph);
	return argEdge !== undefined ? walk(argEdge.target, ctx) : emptyStruct(ctx);
};

const application = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const funcEdge = Edges.one(id, Labels.FUNC)(ctx.graph);
	const argEdge = Edges.one(id, Labels.ARG)(ctx.graph);
	const [fn, c1] = funcEdge !== undefined ? walk(funcEdge.target, ctx) : C.name(ctx);
	const [arg, c2] = argEdge !== undefined ? walk(argEdge.target, c1) : C.name(c1);
	const [fnRef, c3] = C.name(c2, "fnref");
	const [envRef, c4] = C.name(c3, "env");
	const [result, c5] = C.name(c4);
	const c6 = C.instr(c5, Constructors.Instr.Read("__fn", fn, fnRef));
	const c7 = C.instr(c6, Constructors.Instr.Read("__env", fn, envRef));
	const c8 = C.instr(c7, Constructors.Instr.Call({ type: "indirect", callee: fnRef }, [envRef, arg], result));
	return [result, C.bind(c8, id, result)];
};

const letNode = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const valueEdge = Edges.one(id, Labels.VALUE)(ctx.graph);
	const [val, c1] = valueEdge !== undefined ? walk(valueEdge.target, ctx) : C.name(ctx);
	const c2 = C.bind(c1, id, val);
	const bodyEdge = Edges.one(id, Labels.BODY)(ctx.graph);
	return bodyEdge !== undefined ? walk(bodyEdge.target, c2) : [val, c2];
};

const struct = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const fields = collectFields(id, ctx);
	const [pairs, c1] = fields.reduce<[ReadonlyArray<{ label: string; value: string }>, Ctx]>(
		([acc, c], { label, valueId }) => {
			const [v, c2] = walk(valueId, c);
			return [[...acc, { label, value: v }], C.bindLabel(c2, label, v)];
		},
		[[], ctx],
	);
	const [result, c2] = C.name(c1);
	const c3 = C.instr(c2, Constructors.Instr.Alloc({ type: "Record", fields: [...pairs] }, result));
	return [result, C.bind(c3, id, result)];
};

const emptyStruct = (ctx: Ctx): [string, Ctx] => {
	const [result, c1] = C.name(ctx);
	const c2 = C.instr(c1, Constructors.Instr.Alloc({ type: "Record", fields: [] }, result));
	return [result, c2];
};

type Field = { readonly label: string; readonly valueId: NodeId };

const collectFields = (id: NodeId, ctx: Ctx): ReadonlyArray<Field> => {
	const node = Nodes.get(id)(ctx.graph);
	return node?.tag !== Tags.ROW_EXT
		? []
		: [
				{ label: (node.payload.label ?? "") as string, valueId: Edges.one(id, Labels.VALUE)(ctx.graph)?.target ?? id },
				...collectFields(Edges.one(id, Labels.REST)(ctx.graph)?.target ?? -1, ctx),
			];
};
