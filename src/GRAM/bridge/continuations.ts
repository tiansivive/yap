import { Edges, Query, type NodeId } from "../graph";
import { Labels } from "../vocabulary";
import { Constructors as M } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

type Walk = (id: NodeId, ctx: Ctx) => [string, Ctx];

export const reset = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const body = Query.follow(id, Labels.ENTRY)(ctx.graph) ?? Query.follow(id, Labels.BODY)(ctx.graph);
	return body === undefined ? C.name(ctx) : walk(body, ctx);
};

export const resume = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const k = get(id, Labels.INVOKES, ctx);
	const [arg, c0] = walk(get(id, Labels.ARG, ctx), ctx);
	const [kenv, c1] = C.name(c0, "kenv");
	const [henv, c2] = C.name(c1, "henv");
	const [site, c3] = C.name(c2, "site");
	const [after, c4] = C.name(c3, "after");
	const [result, c5] = C.name(c4, "resumed");
	const [saved, c6] = C.name(c5, "saved");
	const sites = c6.returns.get(k) ?? [];
	const fields = captures(k, ctx).map(binder => {
		const value = C.resolve(c0, binder);
		if (value === undefined) {
			throw new Error(`GRAM bridge: missing continuation capture ${binder}`);
		}
		return { label: `v${binder}`, value };
	});
	const c7 = C.instr(c6, M.Instr.Alloc({ type: "Record", fields }, kenv));
	const c8 = C.instr(c7, M.Instr.Alloc({ type: "Record", fields: [...c0.names].map(([binder, value]) => ({ label: `v${binder}`, value })) }, henv));
	const c9 = C.instr(c8, M.Instr.Let(site, M.Expr.Lit({ type: "Num", value: sites.length })));
	const c10 = C.close(c9, M.Terminator.Jump(`k${k}`, [arg, kenv, henv, site]));
	const next = C.open(
		{
			...c10,
			names: new Map(),
			returns: new Map([
				...c10.returns,
				[
					k,
					[
						...sites,
						{
							value: String(sites.length),
							target: after,
							args: [`k${k}_value`, `k${k}_handler`],
						},
					],
				],
			]),
		},
		after,
		[result, saved],
	);
	const restored = [...c0.names.keys()].reduce((c, binder) => {
		const [value, cc] = C.name(c, "saved");
		return C.bind(C.instr(cc, M.Instr.Read(`v${binder}`, saved, value)), binder, value);
	}, next);
	return [result, C.bind(restored, id, result)];
};

export const complete = (walk: Walk, ctx: Ctx): Ctx => {
	const pending = [...ctx.returns.keys()].filter(id => !ctx.blocks.some(b => b.label === `k${id}`));
	if (pending.length > 0) {
		return complete(
			walk,
			pending.reduce((c, id) => continuation(id, walk, c), ctx),
		);
	}
	return [...ctx.returns].reduce(
		(c, [id, cases]) =>
			C.block(c, M.Block(`k${id}_return`, [`k${id}_value`, `k${id}_handler`, `k${id}_site`], [], M.Terminator.Branch(`k${id}_site`, [...cases]))),
		ctx,
	);
};

const continuation = (id: NodeId, walk: Walk, ctx: Ctx): Ctx => {
	const hole = get(id, Labels.HOLE, ctx);
	const start = C.open(
		{
			...ctx,
			names: new Map([
				[hole, `k${id}_hole`],
				[-1, `k${id}_caller`],
				[-2, `k${id}_index`],
			]),
			labels: new Map(),
		},
		`k${id}`,
		[`k${id}_hole`, `k${id}_captured`, `k${id}_caller`, `k${id}_index`],
	);
	const restored = captures(id, ctx).reduce((c, binder) => {
		const [value, next] = C.name(c, "captured");
		return C.bind(C.instr(next, M.Instr.Read(`v${binder}`, `k${id}_captured`, value)), binder, value);
	}, start);
	const [value, end] = walk(get(id, Labels.BODY, ctx), restored);
	return C.close(end, M.Terminator.Jump(`k${id}_return`, [value, C.bound(end, -1), C.bound(end, -2)]));
};

const get = (id: NodeId, label: string, ctx: Ctx): NodeId => {
	const target = Query.follow(id, label)(ctx.graph);
	if (target === undefined) {
		throw new Error(`GRAM bridge: ${id} requires ${label}`);
	}
	return target;
};

const captures = (id: NodeId, ctx: Ctx): readonly NodeId[] => {
	const env = Query.follow(id, Labels.ENV)(ctx.graph);
	return env === undefined ? [] : Edges.byLabel(env, Labels.CAPTURE)(ctx.graph).map(e => e.target);
};
