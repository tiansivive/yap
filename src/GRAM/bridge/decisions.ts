import { match } from "ts-pattern";
import { Nodes, Edges, type NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors as M, type Case } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

type Walk = (id: NodeId, ctx: Ctx) => [string, Ctx];

export const decision = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const target = Edges.one(id, Labels.DECISION_TREE)(ctx.graph)?.target;
	const scrut = Edges.one(id, Labels.SCRUTINEE)(ctx.graph)?.target;
	const [, next] = scrut === undefined ? C.name(ctx) : walk(scrut, ctx);
	return target === undefined ? C.name(next) : tree(target, walk, next);
};

export const tree = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] =>
	match(Nodes.get(id)(ctx.graph)?.tag)
		.with(Tags.LEAF, () => {
			const bound = Edges.byLabel(
				id,
				Labels.BIND,
			)(ctx.graph).reduce((c, edge) => {
				const [value, next] = walk(edge.target, c);
				const binder = edge.payload.binder as NodeId | undefined;
				return binder === undefined ? next : C.bind(next, binder, value);
			}, ctx);
			return walk(C.target(ctx, id, Labels.BODY), bound);
		})
		.with(Tags.SWITCH, () => branch(id, walk, ctx))
		.otherwise(() => {
			const [value, next] = C.name(ctx, "fail");
			return [value, C.instr(next, M.Instr.Let(value, M.Expr.Lit({ type: "Atom", value: "match_failure" })))];
		});

const branch = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const kind = Nodes.get(id)(ctx.graph)?.payload.kind;
	const [inspected, c0] = walk(C.target(ctx, id, Labels.INSPECT), ctx);
	const branches = Edges.byLabel(id, Labels.BRANCH)(ctx.graph);
	if (kind === "struct") {
		return tree(branches[0].target, walk, c0);
	}
	const [tag, c1] = kind === "tag" ? readTag(inspected, c0) : [inspected, c0];
	const [join, c2] = C.name(c1, "join");
	const [result, c3] = C.name(c2, "match");
	const [saved, c4] = [...c0.names.keys()].reduce<[ReadonlyMap<NodeId, string>, Ctx]>(
		([names, c], binder) => {
			const [name, next] = C.name(c, "joined");
			return [new Map([...names, [binder, name]]), next];
		},
		[new Map(), c3],
	);
	const fallback = Edges.one(id, Labels.DEFAULT)(ctx.graph);
	const alternatives = [...branches, ...(fallback === undefined ? [] : [fallback])];
	const targets = alternatives.map((_, i) => `case${c4.supply + i}`);
	const args = [...c0.names.values()];
	const cases: Case[] = branches.map((edge, i) => ({
		value: kind === "tag" ? String(edge.payload.label) : literal(edge.payload.value),
		target: targets[i],
		args,
	}));
	const before = C.close(
		{ ...c4, supply: c4.supply + targets.length },
		M.Terminator.Branch(tag, cases, fallback === undefined ? undefined : { target: targets[targets.length - 1], args }),
	);
	const end = alternatives.reduce((c, edge, i) => {
		const names = new Map([...c0.names.keys()].map((binder, j) => [binder, `${targets[i]}_v${j}`]));
		const start = C.open({ ...c, names, labels: c0.labels }, targets[i], [...names.values()]);
		const [value, next] = tree(edge.target, walk, start);
		return C.close(next, M.Terminator.Jump(join, [value, ...[...saved.keys()].map(binder => C.bound(next, binder))]));
	}, before);
	return [result, C.open({ ...end, names: saved, labels: c0.labels }, join, [result, ...saved.values()])];
};

const literal = (value: unknown): string => {
	const lit = value as { value?: unknown } | undefined;
	return String(lit?.value ?? value);
};

const readTag = (value: string, ctx: Ctx): [string, Ctx] => {
	const [tag, next] = C.name(ctx, "tag");
	return [tag, C.instr(next, M.Instr.Read("__tag", value, tag))];
};
