import { Nodes, Edges, Query } from "../graph";
import type { NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Terminator, Block, Function: Fn, Instr, Expr } = Constructors;

// Closure → MIR.Function + FuncRef at use site
// The closure node wraps a lambda; the env holds captures.
// We emit a function whose params = [env captures..., lambda param].
export const closure = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const bodyEdge = Edges.one(id, Labels.BODY)(ctx.graph);
	const envEdge = Edges.one(id, Labels.ENV)(ctx.graph);
	const lamId = bodyEdge?.target;
	const envId = envEdge?.target;
	const lamNode = lamId !== undefined ? Nodes.get(lamId)(ctx.graph) : undefined;
	const funcName = `closure_${id}`;
	const paramName = (lamNode?.payload.variable ?? "arg") as string;
	const captures = envId !== undefined ? captureParams(envId, ctx) : [];
	const allParams = [...captures.map(c => c.name), paramName];

	// Build function body in a fresh context
	const inner = C.fresh(ctx.graph);
	const bound = captures.reduce<Ctx>((c, cap) => C.bind(c, cap.target, cap.name), inner);
	const withLam = lamId !== undefined ? C.bind(bound, lamId, paramName) : bound;
	const lamBody = lamId !== undefined ? Edges.one(lamId, Labels.BODY)(ctx.graph) : undefined;
	const [result, final] = lamBody !== undefined ? walk(lamBody.target, withLam) : C.name(withLam);
	const [instrs, flushed] = C.flush(final);
	const entryBlock =
		flushed.blocks.length > 0
			? Block("entry", [], [...instrs], Terminator.Jump(flushed.blocks[0].label, []))
			: Block("entry", [], [...instrs], Terminator.Return(result));
	const fn = Fn(funcName, allParams, "entry", [entryBlock, ...flushed.blocks]);

	// Detect curried returns: if the body returns a FuncRef to a nested closure
	// that has captures from this scope, a bare FuncRef is insufficient — the
	// captures need to be bundled into a runtime closure struct.
	const nestedWithCaptures = flushed.functions.filter(f => f.params.some(p => allParams.includes(p)));
	if (nestedWithCaptures.length > 0) {
		throw new Error("Bridge: closure capture not yet implemented for curried returns — nested closures reference outer captures");
	}

	// Register function + any nested functions from body, emit FuncRef at use site
	const withNested = flushed.functions.reduce<Ctx>((c, f) => C.func(c, f), ctx);
	const c1 = C.func(withNested, fn);
	const [ref, c2] = C.name(c1);
	const c3 = C.instr(c2, Instr.Let(ref, Expr.FuncRef(funcName)));
	return [ref, C.bind(c3, id, ref)];
};

type Capture = { readonly name: string; readonly target: NodeId };

const captureParams = (envId: NodeId, ctx: Ctx): ReadonlyArray<Capture> =>
	Edges.byLabel(
		envId,
		Labels.CAPTURE,
	)(ctx.graph)
		.slice()
		.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0))
		.map((e, i) => ({
			name: resolveName(e.target, ctx) ?? `cap${i}`,
			target: e.target,
		}));

const resolveName = (id: NodeId, ctx: Ctx): string | undefined => {
	const node = Nodes.get(id)(ctx.graph);
	return (node?.payload.name as string) ?? (node?.payload.variable as string) ?? undefined;
};
