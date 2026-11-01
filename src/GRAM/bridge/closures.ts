import { Nodes, Edges } from "../graph";
import type { NodeId } from "../graph";
import { Labels } from "../vocabulary";
import { Constructors } from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";
import * as Closure from "./bundle";
import * as Continuations from "./continuations";

const { Terminator, Function: Fn } = Constructors;

// Closure → MIR.Function(env, formal) + { __fn, __env } bundle at the use site.
export const closure = (id: NodeId, walk: (id: NodeId, ctx: Ctx) => [string, Ctx], ctx: Ctx): [string, Ctx] => {
	const bodyEdge = Edges.one(id, Labels.BODY)(ctx.graph);
	const envEdge = Edges.one(id, Labels.ENV)(ctx.graph);
	const lamId = bodyEdge?.target;
	const envId = envEdge?.target;
	const lamNode = lamId !== undefined ? Nodes.get(lamId)(ctx.graph) : undefined;
	const funcName = `closure_${id}`;
	const formal = (lamNode?.payload.variable ?? "arg") as string;
	const captures = envId !== undefined ? captureParams(envId, ctx) : [];

	const [envParam, c0] = C.name(ctx, "env");
	const [formalParam, c1] = C.name(c0, formal);
	const { vars: capVars, instrs: envReads } = Closure.read(captures.length, envParam);

	const bodyCtx = captures.reduce(
		(c, cap, i) => {
			const v = capVars[i];
			return v !== undefined ? C.bind(c, cap.target, v) : c;
		},
		C.bind({ ...C.fork(c1), names: new Map(), labels: new Map(), instrs: envReads }, lamId ?? -1, formalParam),
	);

	const lamBody = lamId !== undefined ? Edges.one(lamId, Labels.BODY)(ctx.graph) : undefined;
	const [bodyResult, final] = lamBody !== undefined ? walk(lamBody.target, bodyCtx) : C.name(bodyCtx);
	const completed = Continuations.complete(walk, C.close(final, Terminator.Return(bodyResult)));
	const fn = Fn(funcName, [envParam, formalParam], "entry", [...completed.blocks]);
	const withNested = completed.functions.reduce<Ctx>((c, f) => C.func(c, f), { ...c1, supply: completed.supply });
	const withFn = C.func(withNested, fn);

	const capturedValues = captures.map(cap => C.resolve(ctx, cap.target) ?? cap.name);
	return Closure.emit(funcName, capturedValues, withFn, id);
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
