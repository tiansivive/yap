import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";
import { match } from "ts-pattern";

const { Instr, Expr } = Constructors;
const erasable = new Set<string>([Tags.MU, Tags.PI, Tags.SIGMA, Tags.VAR_META]);

export const lower = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const stmts = sortedStatements(id, ctx);
	const c1 = stmts.reduce<Ctx>((c, sid) => statement(sid, walk, c), ctx);
	const retEdge = Edges.one(id, Labels.RETURN)(ctx.graph);
	return retEdge !== undefined ? walk(retEdge.target, c1) : C.name(c1);
};

const sortedStatements = (blockId: NodeId, ctx: Ctx): ReadonlyArray<NodeId> => {
	const edges = Edges.byLabel(blockId, Labels.STMT)(ctx.graph);
	return [...edges].sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0)).map(e => e.target);
};

const statement = (sid: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): Ctx =>
	match(Nodes.get(sid)(ctx.graph)?.tag)
		.with(Tags.STMT_LET, () => letStmt(sid, walk, ctx))
		.with(Tags.STMT_EXPR, () => exprStmt(sid, walk, ctx))
		.with(Tags.STMT_USING, () => exprStmt(sid, walk, ctx))
		.otherwise(() => ctx);

const letStmt = (sid: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): Ctx => {
	const valueEdge = Edges.one(sid, Labels.VALUE)(ctx.graph);
	const [val, c1] = valueEdge !== undefined ? walk(valueEdge.target, ctx) : C.name(ctx);
	const variable = (Nodes.get(sid)(ctx.graph)?.payload.variable ?? "") as string;
	const [n, c2] = C.name(c1, variable);
	const c3 = C.instr(c2, Instr.Let(n, Expr.Var(val), valueEdge === undefined ? undefined : erasure(valueEdge.target, ctx)));
	return C.bind(c3, sid, n);
};

const erasure = (id: NodeId, ctx: Ctx): MIR.Debug | undefined => {
	const node = Nodes.get(id)(ctx.graph);
	if (node === undefined || !erasable.has(node.tag)) {
		return undefined;
	}

	const source = node.payload.source ?? node.payload.variable;
	return { erasure: { tag: node.tag, ...(source !== undefined && { source }) } };
};

const exprStmt = (sid: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): Ctx => {
	const valueEdge = Edges.one(sid, Labels.VALUE)(ctx.graph);
	return valueEdge !== undefined ? walk(valueEdge.target, ctx)[1] : ctx;
};
