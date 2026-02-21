import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import { Implicitness } from "@yap/shared/implicitness";
import { match, P } from "ts-pattern";
import { SyntaxType } from "@yap/cst/types/generated";

type Lambda = CST.Types.LambdaNode;
type Chain = CST.Types.ElamNode | CST.Types.IlamNode;
type Pi = NF.Value & { binder: { type: "Pi"; variable: string; annotation: NF.Value; icit: Implicitness }; closure: NF.Closure };

const icitOf = (node: Chain): Implicitness => (node.type === "elam" ? "Explicit" : "Implicit");

/** Walk an elam/ilam chain against nested Pi binders.
 *  At each step: extract param, check/quote annotation, bind variable, recurse into body. */
const checkChain = function* (node: Chain, pi: Pi): Generator<M.Elaboration<any>, EB.Term, any> {
	const ctx = yield* M.ask();
	const { name: variable, annotation } = CST.Utils.extractParam(node.paramNode);

	const ann = annotation
		? yield* tmp.check(annotation, pi.binder.annotation)
		: NF.quote(ctx, ctx.env.length, pi.binder.annotation);

	const bType = NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));

	return yield* M.local(
		ctx => EB.bind(ctx, { type: "Lambda", variable }, pi.binder.annotation),
		M.Do(function* () {
			const body = node.bodyNode;

			const inner: EB.Term = yield* match(body)
				.with({ type: SyntaxType.Elam }, { type: SyntaxType.Ilam }, b => checkBody(b, bType))
				.otherwise(b => tmp.check(b, bType));

			return EB.Constructors.Lambda(variable, pi.binder.icit, inner, ann);
		}),
	);
};

/** Route a chain body node: continue the chain walk if Pi icit matches, otherwise delegate to tmp.check
 *  which handles implicit insertion and fallthrough via the general checker → Pi.check. */
const checkBody = function* (body: Chain, type: NF.Value): Generator<M.Elaboration<any>, EB.Term, any> {
	return yield* match(type)
		.with({ type: "Abs", binder: { type: "Pi" } }, pi => pi.binder.icit === icitOf(body), pi => checkChain(body, pi))
		.otherwise(() => tmp.check(body, type));
};

/** Insert an implicit Lambda binder when the expected type is an implicit Pi
 *  but the term isn't an implicit lambda. Uses the Pi's variable name and annotation. */
export const insertImplicit = function* (node: CST.Types.SyntaxNode, pi: Pi): Generator<M.Elaboration<any>, EB.Term, any> {
	const ctx = yield* M.ask();
	const ann = NF.quote(ctx, ctx.env.length, pi.binder.annotation);
	const bType = NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));

	return yield* M.local(
		ctx => EB.bind(ctx, { type: "Lambda", variable: pi.binder.variable }, pi.binder.annotation, "inserted"),
		M.Do(function* () {
			const inner = yield* tmp.check(node, bType);
			return EB.Constructors.Lambda(pi.binder.variable, "Implicit", inner, ann);
		}),
	);
};

/** Top-level: check any CST node against a Pi type.
 *  - Lambda with matching icit → walk the chain
 *  - Implicit Pi → insert implicit binder, recurse
 *  - Otherwise → infer + unify fallthrough */
export const check = function* (node: CST.Types.SyntaxNode, pi: Pi): Generator<M.Elaboration<any>, EB.Term, any> {
	return yield* match([node, pi.binder.icit] as const)
		// Explicit lambda checked against explicit Pi
		.with([{ type: SyntaxType.Lambda }, "Explicit"], ([l]) => !!l.explicitNode, ([l]) => checkChain(l.explicitNode!, pi))
		// Implicit lambda checked against implicit Pi
		.with([{ type: SyntaxType.Lambda }, "Implicit"], ([l]) => !!l.implicitNode, ([l]) => checkChain(l.implicitNode!, pi))
		// Any term against implicit Pi → insert implicit binder
		.with([P._, "Implicit"], ([n]) => insertImplicit(n, pi))
		// Fallthrough → infer + unify
		.otherwise(([n]) => inferUnify(n, pi));
};

// TODO: Refactor this infer+unify fallthrough into a reusable utility.
// We inline it here to prevent a loop: calling tmp.check would re-dispatch
// back to this Pi checker, so we must handle it directly.
const inferUnify = function* (node: CST.Types.SyntaxNode, pi: Pi): Generator<M.Elaboration<any>, EB.Term, any> {
	const ctx = yield* M.ask();
	const [tm, inferred] = yield* tmp.infer(node);
	yield* M.tell("constraint", { type: "assign", left: inferred, right: pi as NF.Value, lvl: ctx.env.length });
	return tm;
};
