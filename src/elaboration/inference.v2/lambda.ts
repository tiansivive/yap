import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import { Implicitness } from "@yap/shared/implicitness";
import { update } from "@yap/utils";
import { match } from "ts-pattern";
import { SyntaxType } from "@yap/cst/types/generated";

type Lambda = CST.Types.LambdaNode;
type Chain = CST.Types.ElamNode | CST.Types.IlamNode;

const icitOf = (node: Chain): Implicitness => (node.type === "elam" ? "Explicit" : "Implicit");

/** Walk an elam/ilam chain, building nested Lambda/Pi at each param.
 *  When `bodyNode` is another chain node of the same icity, recurse.
 *  When `bodyNode` is a `lambda` (icity change) or any other expr, handle accordingly. */
const walkChain = function* (node: Chain, icit: Implicitness): Generator<M.Elaboration<any>, tmp.Typing, any> {
	const ctx = yield* M.ask();
	const { name: variable, annotation } = CST.Utils.extractParam(node.paramNode);

	const ann = annotation
		? yield* tmp.check(annotation, NF.Type)
		: EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));

	const ty = NF.evaluate(ctx, ann);
	const { metas } = yield* M.listen();

	return yield* M.local(
		_ctx => {
			const xtended = EB.bind(_ctx, { type: "Lambda", variable }, ty);
			return update(xtended, "metas", ms => ({ ...ms, ...metas }));
		},
		M.Do(function* () {
			const body = node.bodyNode;

			const inner: tmp.Typing = yield* match(body)
				.with({ type: SyntaxType.Elam }, { type: SyntaxType.Ilam }, b => walkChain(b, icitOf(b)))
				.otherwise(inferBody);

			const tm = EB.Constructors.Lambda(variable, icit, inner[0], ann);
			const pi = NF.Constructors.Pi(variable, icit, ty, NF.closeVal(ctx, inner[1]));
			return [tm, pi] satisfies tmp.Typing;
		}),
	);
};

/** Infer the body expression at the end of a chain */
const inferBody = function* (body: CST.Types.SyntaxNode): Generator<M.Elaboration<any>, tmp.Typing, any> {
	const inferred = yield* tmp.infer(body);
	return yield* EB.Icit.insert.gen(inferred);
};

/** Top-level lambda inference: dispatch to the elam or ilam chain */
const inferLambda = function* (node: Lambda): Generator<M.Elaboration<any>, tmp.Typing, any> {
	const chain: Chain = node.explicitNode ?? node.implicitNode!;
	return yield* walkChain(chain, icitOf(chain));
};

export const infer = (node: Lambda): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Lambda node" } },
		M.Do(function* () {
			return yield* inferLambda(node);
		}),
	);
