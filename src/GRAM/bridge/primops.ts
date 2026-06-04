import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";
import * as Paps from "./pap";

const { Instr, Expr } = Constructors;

export const primop = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const op = (Nodes.get(id)(ctx.graph)?.payload.op ?? "") as string;
	const [argNames, c1] = walkArgs(id, walk, ctx);
	const [result, c2] = C.name(c1);
	const c3 = C.instr(c2, Instr.Let(result, Expr.PrimOp(op, [...argNames])));
	return [result, C.bind(c3, id, result)];
};

export const external = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const papEdge = Edges.to(id)(ctx.graph).find(e => e.label === Labels.MATERIALIZES && Nodes.get(e.source)(ctx.graph)?.tag === Tags.PAP);

	if (papEdge !== undefined) {
		return Paps.pap(papEdge.source, walk, ctx);
	}

	const payload = Nodes.get(id)(ctx.graph)?.payload;
	const name = (payload?.name ?? "") as string;
	const [argNames, c1] = walkArgs(id, walk, ctx);
	const [result, c2] = C.name(c1);
	const c3 = C.instr(c2, Instr.Call({ type: "direct", func: name }, [...argNames], result));
	return [result, C.bind(c3, id, result)];
};

const walkArgs = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [ReadonlyArray<string>, Ctx] =>
	sortedArgs(id, ctx).reduce<[ReadonlyArray<string>, Ctx]>(
		([acc, c], argId) => {
			const [n, c2] = walk(argId, c);
			return [[...acc, n], c2];
		},
		[[], ctx],
	);

const sortedArgs = (id: NodeId, ctx: Ctx): ReadonlyArray<NodeId> =>
	Edges.byLabel(
		id,
		Labels.ARG,
	)(ctx.graph)
		.slice()
		.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0))
		.map(e => e.target);
