import type { Literal } from "@yap/shared/literals";

import { Nodes, Edges, Query } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Expr, Instr } = Constructors;

export const lit = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const payload = Nodes.get(id)(ctx.graph)?.payload;
	const [n, c1] = C.name(ctx);
	const c2 = C.instr(c1, Instr.Let(n, Expr.Lit(payload?.value as Literal)));
	return [n, C.bind(c2, id, n)];
};

export const bound = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const ref = Query.follow(id, Labels.REFERS_TO)(ctx.graph);
	const resolved = ref !== undefined ? C.resolve(ctx, ref) : undefined;
	return resolved !== undefined ? [resolved, ctx] : passthrough(id, ctx);
};

export const free = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const target = Edges.one(id, Labels.REFERS_TO)(ctx.graph)?.target;
	const payload = target !== undefined ? Nodes.get(target)(ctx.graph)?.payload : undefined;
	const n = (payload?.name as string) ?? "unknown";
	const [v, c1] = C.name(ctx);
	const c2 = C.instr(c1, Instr.Let(v, Expr.Var(n)));
	return [v, C.bind(c2, id, v)];
};

export const foreign = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const target = Edges.one(id, Labels.REFERS_TO)(ctx.graph)?.target;
	const payload = target !== undefined ? Nodes.get(target)(ctx.graph)?.payload : undefined;
	const n = (payload?.name as string) ?? "unknown";
	const [v, c1] = C.name(ctx);
	const c2 = C.instr(c1, Instr.Let(v, Expr.FuncRef(n)));
	return [v, C.bind(c2, id, v)];
};

export const passthrough = (id: NodeId, ctx: Ctx): [string, Ctx] => {
	const existing = C.resolve(ctx, id);
	return existing !== undefined ? [existing, ctx] : C.name(ctx);
};
