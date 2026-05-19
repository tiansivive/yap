import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Instr } = Constructors;

export const read = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const label = (Nodes.get(id)(ctx.graph)?.payload.label ?? "") as string;
	const targetEdge = Edges.one(id, Labels.TARGET)(ctx.graph);
	const [target, c1] = targetEdge !== undefined ? walk(targetEdge.target, ctx) : C.name(ctx);
	const [result, c2] = C.name(c1);
	const c3 = C.instr(c2, Instr.Read(label, target, result));
	return [result, C.bind(c3, id, result)];
};

export const update = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const label = (Nodes.get(id)(ctx.graph)?.payload.label ?? "") as string;
	const valueEdge = Edges.one(id, Labels.VALUE)(ctx.graph);
	const targetEdge = Edges.one(id, Labels.TARGET)(ctx.graph);
	const [value, c1] = valueEdge !== undefined ? walk(valueEdge.target, ctx) : C.name(ctx);
	const [into, c2] = targetEdge !== undefined ? walk(targetEdge.target, c1) : C.name(c1);
	const [result, c3] = C.name(c2);
	const c4 = C.instr(c3, Instr.UpdateImmutable(into, result, { type: "Record", fields: [{ label, value }] }));
	return [result, C.bind(c4, id, result)];
};
