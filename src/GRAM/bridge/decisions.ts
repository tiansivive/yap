import { match } from "ts-pattern";

import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Instr, Expr, Terminator, Block } = Constructors;

// Match node → follow :decision_tree to the compiled tree, walk the scrutinee
export const decision = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const treeEdge = Edges.one(id, Labels.DECISION_TREE)(ctx.graph);
	const scrutEdge = Edges.one(id, Labels.SCRUTINEE)(ctx.graph);
	const [scrut, c1] = scrutEdge !== undefined ? walk(scrutEdge.target, ctx) : C.name(ctx);
	return treeEdge !== undefined ? emitTree(treeEdge.target, scrut, walk, c1) : C.name(c1);
};

const emitTree = (id: NodeId, scrut: string, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] =>
	match(Nodes.get(id)(ctx.graph)?.tag)
		.with(Tags.LEAF, () => emitLeaf(id, scrut, walk, ctx))
		.with(Tags.FAIL, () => emitFail(ctx))
		.with(Tags.SWITCH, () => emitSwitch(id, scrut, walk, ctx))
		.otherwise(() => C.name(ctx));

const emitLeaf = (id: NodeId, scrut: string, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const bindings = Edges.byLabel(id, Labels.BIND)(ctx.graph);
	const c1 = bindings.reduce<Ctx>((c, edge) => {
		const name = (edge.payload.name ?? "") as string;

		if (name === "") {
			return c;
		}
		const [val, c2] = walk(edge.target, c);
		const c3 = C.instr(c2, Instr.Let(name, Expr.Var(val)));
		const binderId = edge.payload.binder as NodeId | undefined;
		return binderId !== undefined ? C.bind(C.bind(c3, edge.target, name), binderId, name) : C.bind(c3, edge.target, name);
	}, ctx);
	const bodyEdge = Edges.one(id, Labels.BODY)(ctx.graph);
	return bodyEdge !== undefined ? walk(bodyEdge.target, c1) : C.name(c1);
};

const emitFail = (ctx: Ctx): [string, Ctx] => {
	const [n, c1] = C.name(ctx, "fail");
	return [n, C.instr(c1, Instr.Let(n, Expr.Lit({ type: "Atom", value: "match_failure" })))];
};

const emitSwitch = (id: NodeId, scrut: string, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const kind = (Nodes.get(id)(ctx.graph)?.payload.kind ?? "tag") as string;
	const inspectEdge = Edges.one(id, Labels.INSPECT)(ctx.graph);
	const [inspected, cI] = inspectEdge !== undefined ? walk(inspectEdge.target, ctx) : [scrut, ctx];

	if (kind === "struct") {
		const branch = Edges.one(id, Labels.BRANCH)(ctx.graph);
		if (!branch) {
			return C.name(cI);
		}
		return emitTree(branch.target, inspected, walk, cI);
	}

	// Discriminant: for variant dispatch read __tag, for literal use value directly
	const [disc, c1] = match(kind)
		.with("tag", () => readTag(inspected, cI))
		.otherwise(() => [inspected, cI]);

	const branches = Edges.byLabel(id, Labels.BRANCH)(ctx.graph);
	const defaultEdge = Edges.one(id, Labels.DEFAULT)(ctx.graph);

	// Result join: all branches write to this variable
	const [resultVar, c2] = C.name(c1, "match");

	// Pre-block label: the branch terminator lives here
	const [preLabel, c3] = C.name(c2, "sw");

	// Join block label
	const [joinLabel, c4] = C.name(c3, "join");

	// Build case blocks + MIR cases (collect blocks separately for ordering)
	const [cases, caseBlocks, c5] = branches.reduce<[ReadonlyArray<MIR.Case>, ReadonlyArray<MIR.Block>, Ctx]>(
		([acc, blks, c], edge) => {
			const [caseLabel, c2a] = C.name(c, "case");
			const inner = C.fork(c2a);
			const [val, cInner] = emitTree(edge.target, scrut, walk, inner);
			const [instrs, flushed] = C.flush(cInner);
			const caseBlock = Block(caseLabel, [], [...instrs, Instr.Let(resultVar, Expr.Var(val))], Terminator.Jump(joinLabel, []));
			const cWithFns = flushed.functions.reduce<Ctx>((cc, f) => C.func(cc, f), c2a);
			const caseValue = extractValue(edge, kind);
			return [[...acc, { value: caseValue, target: caseLabel, args: [] }], [...blks, caseBlock, ...flushed.blocks], cWithFns];
		},
		[[], [], c4],
	);

	// Default block
	const [defTarget, defBlocks, c6] =
		defaultEdge !== undefined ? buildDefault(defaultEdge.target, scrut, walk, resultVar, joinLabel, c5) : [undefined, [] as ReadonlyArray<MIR.Block>, c5];

	// Pre-block with Branch terminator
	const [pending, c7] = C.flush(c6);
	const preBlock = Block(preLabel, [], [...pending], Terminator.Branch(disc, [...cases], defTarget));

	// Join block
	const joinBlock = Block(joinLabel, [], [], Terminator.Return(resultVar));

	// Order: pre-block first (entry point), then cases, default, join
	const allBlocks = [preBlock, ...caseBlocks, ...defBlocks, joinBlock];
	const c8 = allBlocks.reduce<Ctx>((c, b) => C.block(c, b), c7);

	return [resultVar, c8];
};

const buildDefault = (
	id: NodeId,
	scrut: string,
	walk: (id: NodeId, ctx: Ctx) => [string, Ctx],
	resultVar: string,
	joinLabel: string,
	ctx: Ctx,
): [MIR.DefaultCase, ReadonlyArray<MIR.Block>, Ctx] => {
	const [defLabel, c1] = C.name(ctx, "default");
	const inner = C.fork(c1);
	const [val, cInner] = emitTree(id, scrut, walk, inner);
	const [instrs, flushed] = C.flush(cInner);
	const defBlock = Block(defLabel, [], [...instrs, Instr.Let(resultVar, Expr.Var(val))], Terminator.Jump(joinLabel, []));
	const c2 = flushed.functions.reduce<Ctx>((c, f) => C.func(c, f), c1);
	return [{ target: defLabel, args: [] }, [defBlock, ...flushed.blocks], c2];
};

const readTag = (target: string, ctx: Ctx): [string, Ctx] => {
	const [result, c1] = C.name(ctx, "tag");
	return [result, C.instr(c1, Instr.Read("__tag", target, result))];
};

const extractValue = (edge: { payload: Record<string, unknown> }, kind: string): string =>
	kind === "tag" ? String(edge.payload.label ?? "") : extractLitValue(edge.payload.value);

const extractLitValue = (v: unknown): string => {
	const lit = v as { type?: string; value?: unknown } | undefined;
	return lit?.value !== undefined ? String(lit.value) : String(v ?? "");
};
