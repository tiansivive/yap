// Shift/reset → MIR state machine (entry → s_init → r → s_i → reset_exit)
import { Nodes, Edges, Query } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Instr, Expr, Terminator, Block } = Constructors;

type Walk = (id: NodeId, ctx: Ctx) => [string, Ctx];

type Capture = { readonly label: string; readonly target: NodeId };

type State = {
	readonly rLabel: string;
	readonly exitLabel: string;
	readonly envVar: string;
	readonly sLabels: ReadonlyArray<string>;
	readonly captures: ReadonlyArray<Capture>;
	readonly kResults: ReadonlyArray<{ idx: number; name: string }>;
	readonly blocks: ReadonlyArray<MIR.Block>;
	readonly blockParams: ReadonlyArray<string>;
	readonly index: number;
};

export const reset = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const bodyTarget = Query.follow(id, Labels.BODY)(ctx.graph);

	if (bodyTarget === undefined) {
		return C.name(ctx);
	}

	const contId = Lookup.continuation(id, ctx);

	if (contId === undefined) {
		return walk(bodyTarget, ctx);
	}

	const bubbleId = Query.follow(contId, Labels.PARAM)(ctx.graph);

	if (bubbleId === undefined) {
		return walk(bodyTarget, ctx);
	}

	const handlerId = Query.follow(contId, Labels.HANDLER)(ctx.graph);

	if (handlerId === undefined) {
		return C.name(ctx);
	}

	const resumes = Edges.to(contId)(ctx.graph)
		.filter(e => e.label === Labels.INVOKES)
		.map(e => e.source);

	const captures = Lookup.captures(contId, ctx);
	return machine(id, bubbleId, contId, handlerId, resumes, captures, walk, ctx);
};

export const resume = (id: NodeId, walk: Walk, ctx: Ctx): [string, Ctx] => {
	const argTarget = Query.follow(id, Labels.ARG)(ctx.graph);
	const [argVal, c1] = argTarget !== undefined ? walk(argTarget, ctx) : C.name(ctx);
	const [result, c2] = C.name(c1, "kr");
	return [result, C.instr(c2, Instr.Let(result, Expr.Var(argVal)))];
};

const machine = (
	resetId: NodeId,
	bubbleId: NodeId,
	_contId: NodeId,
	handlerId: NodeId,
	resumes: ReadonlyArray<NodeId>,
	captures: ReadonlyArray<Capture>,
	walk: Walk,
	ctx: Ctx,
): [string, Ctx] => {
	const [sInit, c1] = C.name(ctx, "s");
	const [rLabel, c2] = C.name(c1, "r");
	const [exitLabel, c3] = C.name(c2, "reset_exit");
	const [exitParam, c4] = C.name(c3, "xr");

	const sLabels = resumes.map((_, i) => `s${c4.supply + i}`);
	const c5: Ctx = { ...c4, supply: c4.supply + resumes.length };

	const [envVar, c6] = C.name(c5, "env");
	const [kVar, c7] = C.name(c6, "k");

	const envFields = captures.map(c => {
		const resolved = C.resolve(c7, c.target);
		return { label: c.label, value: resolved ?? `cap_${c.target}` };
	});
	const c8 = C.instr(c7, Instr.Alloc({ type: "Record", fields: envFields }, envVar));
	const c9 = C.instr(c8, Instr.Alloc({ type: "Record", fields: [{ label: "__env", value: envVar }] }, kVar));
	const [entryInstrs, c10] = C.flush(c9);
	const [preLabel, c11] = C.name(c10, "pre");
	const preBlock = Block(preLabel, [], [...entryInstrs], Terminator.Jump(sInit, [kVar]));

	const [rBlock, c12] = Rest.emit(rLabel, bubbleId, resetId, resumes, sLabels, exitLabel, captures, walk, c11);
	const [sBlocks, c13] = Shift.emit(sInit, handlerId, resumes, captures, rLabel, exitLabel, sLabels, envVar, walk, c12);
	const exitBlock = Block(exitLabel, [exitParam], [], Terminator.Return(exitParam));

	const allBlocks = [preBlock, ...sBlocks, rBlock, exitBlock];
	const c14 = allBlocks.reduce<Ctx>((c, b) => C.block(c, b), c13);

	return [exitParam, C.bind(c14, resetId, exitParam)];
};

const Lookup = {
	continuation: (resetId: NodeId, ctx: Ctx): NodeId | undefined =>
		Edges.to(resetId)(ctx.graph).find(e => e.label === Labels.DELIMITER && Nodes.get(e.source)(ctx.graph)?.tag === Tags.CONTINUATION)?.source,

	captures: (contId: NodeId, ctx: Ctx): ReadonlyArray<Capture> => {
		const handlerId = Query.follow(contId, Labels.HANDLER)(ctx.graph);

		if (handlerId === undefined) {
			return [];
		}

		const closureEdge = Edges.to(handlerId)(ctx.graph).find(e => e.label === Labels.BODY && Nodes.get(e.source)(ctx.graph)?.tag === Tags.CLOSURE);

		if (closureEdge === undefined) {
			return [];
		}

		const envEdge = Edges.one(closureEdge.source, Labels.ENV)(ctx.graph);

		if (envEdge === undefined) {
			return [];
		}

		return Edges.byLabel(
			envEdge.target,
			Labels.CAPTURE,
		)(ctx.graph)
			.slice()
			.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0))
			.map((e, i) => ({ label: `c${i}`, target: e.target }));
	},
};

const Rest = {
	emit: (
		label: string,
		bubbleId: NodeId,
		resetId: NodeId,
		resumes: ReadonlyArray<NodeId>,
		sLabels: ReadonlyArray<string>,
		exitLabel: string,
		captures: ReadonlyArray<Capture>,
		walk: Walk,
		ctx: Ctx,
	): [MIR.Block, Ctx] => {
		const vParam = "v_param";
		const envParam = "env_param";
		const idxParam = "idx_param";

		const inner = C.fork(ctx);
		const bound = C.bind(inner, bubbleId, vParam);

		const withReads = captures.reduce<Ctx>((c, cap) => {
			const [n, c2] = C.name(c, "rc");
			const c3 = C.instr(c2, Instr.Read(cap.label, envParam, n));
			return C.bind(c3, cap.target, n);
		}, bound);

		const bodyTarget = Query.follow(resetId, Labels.BODY)(ctx.graph);
		const [restResult, inner2] = bodyTarget !== undefined ? walk(bodyTarget, withReads) : [vParam, withReads];

		const term =
			resumes.length === 0
				? Terminator.Jump(exitLabel, [restResult])
				: Terminator.Branch(
						idxParam,
						sLabels.map((s, i) => ({ value: String(i), target: s, args: [restResult, envParam] })),
					);

		const [instrs] = C.flush(inner2);
		return [Block(label, [vParam, envParam, idxParam], [...instrs], term), ctx];
	},
};

const Shift = {
	emit: (
		sInit: string,
		handlerId: NodeId,
		resumes: ReadonlyArray<NodeId>,
		captures: ReadonlyArray<Capture>,
		rLabel: string,
		exitLabel: string,
		sLabels: ReadonlyArray<string>,
		envVar: string,
		walk: Walk,
		ctx: Ctx,
	): [ReadonlyArray<MIR.Block>, Ctx] => {
		const kParam = "k_param";
		const [envRead, c1] = C.name(ctx, "env");

		const state: State = {
			rLabel,
			exitLabel,
			envVar,
			sLabels: [sInit, ...sLabels],
			captures,
			kResults: [],
			blocks: [],
			blockParams: [],
			index: 0,
		};

		const handlerBody = Query.follow(handlerId, Labels.BODY)(ctx.graph);
		if (handlerBody === undefined) {
			const block = Block(sInit, [kParam], [], Terminator.Jump(exitLabel, [kParam]));
			return [[block], ctx];
		}

		const inner = C.fork(c1);
		const withEnv = C.instr(inner, Instr.Read("__env", kParam, envRead));
		const withCaptures = captures.reduce<Ctx>((c, cap) => {
			const [n, c2] = C.name(c, "sc");
			const c3 = C.instr(c2, Instr.Read(cap.label, envRead, n));
			return C.bind(c3, cap.target, n);
		}, withEnv);

		const [bodyResult, bodyCtx, finalState] = Seg.walk(handlerBody, state, walk, withCaptures);

		const [finalInstrs] = C.flush(bodyCtx);
		const finalLabel = finalState.sLabels[finalState.index];
		const finalParams = finalState.index === 0 ? [kParam] : finalState.blockParams;
		const finalBlock = Block(finalLabel, [...finalParams], [...finalInstrs], Terminator.Jump(exitLabel, [bodyResult]));

		return [[...finalState.blocks, finalBlock], c1];
	},
};

const Seg = {
	walk: (id: NodeId, state: State, walk: Walk, ctx: Ctx): [string, Ctx, State] => {
		const node = Nodes.get(id)(ctx.graph);

		if (!node) {
			return [...C.name(ctx), state];
		}

		const existing = C.resolve(ctx, id);

		if (existing !== undefined) {
			return [existing, ctx, state];
		}

		if (node.tag === Tags.RESUMPTION) {
			return Seg.resume(id, state, walk, ctx);
		}

		if (node.tag === Tags.PRIMOP) {
			return Seg.primop(id, state, walk, ctx);
		}

		if (node.tag === Tags.EXTERNAL) {
			return Seg.external(id, state, walk, ctx);
		}

		if (node.tag === Tags.APP) {
			return Seg.app(id, state, walk, ctx);
		}

		const [result, c1] = walk(id, ctx);
		return [result, c1, state];
	},

	resume: (id: NodeId, state: State, walk: Walk, ctx: Ctx): [string, Ctx, State] => {
		const argTarget = Query.follow(id, Labels.ARG)(ctx.graph);
		const [argVal, c1] = argTarget !== undefined ? walk(argTarget, ctx) : C.name(ctx);

		// idx must be a Let-bound variable; interpreter resolves Jump args by name
		const [idxVar, c1b] = C.name(c1, "idx");
		const c1c = C.instr(c1b, Instr.Let(idxVar, Expr.Lit({ type: "Num", value: state.index })));

		const [instrs, c2] = C.flush(c1c);
		const currentLabel = state.sLabels[state.index];
		const currentParams = state.index === 0 ? ["k_param"] : [...state.blockParams];
		const block = Block(currentLabel, currentParams, [...instrs], Terminator.Jump(state.rLabel, [argVal, state.envVar, idxVar]));

		const [resultParam, c3] = C.name(c2, "kr");
		const [envIn, c4] = C.name(c3, "env");

		const [envOut, c5] = C.name(c4, "env");
		const stash = Instr.UpdateImmutable(envIn, envOut, { type: "Record", fields: [{ label: `r${state.index}`, value: resultParam }] });
		const c6 = C.instr(c5, stash);

		const [freshResults, c7] = state.kResults.reduce<[ReadonlyArray<{ idx: number; name: string }>, Ctx]>(
			([acc, c], kr) => {
				const [fresh, c2a] = C.name(c, "kr");
				const c3a = C.instr(c2a, Instr.Read(`r${kr.idx}`, envOut, fresh));
				return [[...acc, { idx: kr.idx, name: fresh }], c3a];
			},
			[[], c6],
		);
		const withCaptures = state.captures.reduce<Ctx>((c, cap) => {
			const [capName, c2a] = C.name(c, "rc");
			const c3a = C.instr(c2a, Instr.Read(cap.label, envOut, capName));
			return C.bind(c3a, cap.target, capName);
		}, c7);

		const next: State = {
			...state,
			index: state.index + 1,
			envVar: envOut,
			kResults: [...freshResults, { idx: state.index, name: resultParam }],
			blocks: [...state.blocks, block],
			blockParams: [resultParam, envIn],
		};

		return [resultParam, C.bind(withCaptures, id, resultParam), next];
	},

	primop: (id: NodeId, state: State, walk: Walk, ctx: Ctx): [string, Ctx, State] => {
		const args = Edges.byLabel(
			id,
			Labels.ARG,
		)(ctx.graph)
			.slice()
			.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0));

		const [argVals, c1, s1] = args.reduce<[ReadonlyArray<string>, Ctx, State]>(
			([acc, c, s], edge) => {
				const [val, c2, s2] = Seg.walk(edge.target, s, walk, c);
				return [[...acc, val], c2, s2];
			},
			[[], ctx, state],
		);

		const op = (Nodes.get(id)(ctx.graph)?.payload.op ?? "") as string;
		const [result, c2] = C.name(c1, "p");
		const c3 = C.instr(c2, Instr.Let(result, Expr.PrimOp(op, [...argVals])));
		return [result, C.bind(c3, id, result), s1];
	},

	external: (id: NodeId, state: State, walk: Walk, ctx: Ctx): [string, Ctx, State] => {
		const args = Edges.byLabel(
			id,
			Labels.ARG,
		)(ctx.graph)
			.slice()
			.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0));

		const [argVals, c1, s1] = args.reduce<[ReadonlyArray<string>, Ctx, State]>(
			([acc, c, s], edge) => {
				const [val, c2, s2] = Seg.walk(edge.target, s, walk, c);
				return [[...acc, val], c2, s2];
			},
			[[], ctx, state],
		);

		const func = (Nodes.get(id)(ctx.graph)?.payload.name ?? "") as string;
		const [result, c2] = C.name(c1, "ext");
		const c3 = C.instr(c2, Instr.Call({ type: "direct", func }, [...argVals], result));
		return [result, C.bind(c3, id, result), s1];
	},

	app: (id: NodeId, state: State, walk: Walk, ctx: Ctx): [string, Ctx, State] => {
		const funcTarget = Query.follow(id, Labels.FUNC)(ctx.graph);
		const argTarget = Query.follow(id, Labels.ARG)(ctx.graph);

		const [fn, c1, s1] = funcTarget !== undefined ? Seg.walk(funcTarget, state, walk, ctx) : [...C.name(ctx), state];
		const [arg, c2, s2] = argTarget !== undefined ? Seg.walk(argTarget, s1, walk, c1) : [...C.name(c1), s1];
		const [result, c3] = C.name(c2, "app");
		const c4 = C.instr(c3, Instr.Call({ type: "indirect", callee: fn }, [arg], result));
		return [result, C.bind(c4, id, result), s2];
	},
};
