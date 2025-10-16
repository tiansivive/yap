import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";
import { Implicitness } from "@yap/shared/implicitness";
import * as Modal from "@yap/verification/modalities";
import { Liquid } from "@yap/verification/modalities";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = (node: Application) =>
	V2.track(
		{ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Application node" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const [ft, fty, fus] = yield* V2.pure(inferFn(node));
			const pi = yield* mkPi(NF.force(ctx, fty), node.icit);
			const [at, aus] = yield* V2.pure(checkArg(node, pi[0]));

			const [nf, cls, x] = pi;

			// TODO: Move this to the verification step
			//const rus = Q.add(fus, Q.multiply(quantity, aus));

			const val = NF.apply({ type: "Pi", variable: x }, cls, NF.evaluate(ctx, at));
			return [EB.Constructors.App(node.icit, ft, at), val, fus] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);

const inferFn = (node: Application) =>
	V2.track(
		{ tag: "src", type: "term", term: node.fn, metadata: { action: "infer", description: "inferring function type" } },
		V2.Do(function* () {
			const inferred = yield* EB.infer.gen(node.fn);

			if (node.icit !== "Explicit") {
				return inferred;
			}

			const ast = yield* EB.Icit.insert.gen(inferred);
			return ast;
		}),
	);

const checkArg = ({ arg }: Application, ann: NF.Value) =>
	V2.track({ tag: "src", type: "term", term: arg, metadata: { action: "checking", against: ann, description: "checking argument type" } }, EB.check(arg, ann));

type Pi = [NF.Value, NF.Closure, string];
const mkPi = (fnType: NF.Value, icit: Implicitness): Generator<V2.Elaboration<any>, Pi, any> =>
	match(fnType)
		.with({ type: "Modal" }, ({ value }) => {
			console.warn("Inferred fn as a modal type. Still unsure what to do here. Simply unwrapping the modality for now");
			return mkPi(value, icit);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
			if (pi.binder.icit !== icit) {
				throw new Error("Implicitness mismatch");
			}

			return V2.lift<Pi>([pi.binder.annotation, pi.closure, pi.binder.variable]);
		})
		.otherwise(function* () {
			const ctx = yield* V2.ask();

			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const nf = NF.evaluate(ctx, meta);

			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const closure = NF.Constructors.Closure(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length + 1, kind)));

			const pi = NF.Constructors.Pi("x", icit, nf, closure);

			yield* V2.tell("constraint", { type: "assign", left: fnType, right: pi, lvl: ctx.env.length });
			return [nf, closure, pi.binder.variable] satisfies Pi;
		});
