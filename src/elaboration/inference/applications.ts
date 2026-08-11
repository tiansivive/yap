import * as EB from "@yap/elaboration";

import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";
import { Implicitness } from "@yap/shared/implicitness";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = (node: Application) =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Application node" } }, function* () {
		const [ft, fty, fus] = yield* inferFn(node);
		const pi = yield* mkPi(yield* NF.force(fty), node.icit);
		const [at, _aus] = yield* checkArg(node, pi[0]);

		const [_nf, cls, x] = pi;

		// TODO: Move this to the verification step
		//const rus = Q.add(fus, Q.multiply(quantity, aus));

		const val = yield* NF.apply({ type: "Pi", variable: x }, cls, yield* NF.normalize(at));
		return [EB.Constructors.App(node.icit, ft, at), val, fus] satisfies EB.AST;
	});

const inferFn = (node: Application) =>
	M.tracer.track({ tag: "src", type: "term", term: node.fn, metadata: { action: "infer", description: "inferring function type" } }, function* () {
		const inferred = yield* EB.infer(node.fn);

		if (node.icit !== "Explicit") {
			return inferred;
		}

		const ast = yield* EB.Icit.insert(inferred);
		return ast;
	});

const checkArg = ({ arg }: Application, ann: NF.Value) =>
	M.tracer.track({ tag: "src", type: "term", term: arg, metadata: { action: "checking", against: ann, description: "checking argument type" } }, () =>
		EB.check(arg, ann),
	);

type Pi = [NF.Value, NF.Closure, string];
const mkPi = (fnType: NF.Value, icit: Implicitness): M.Elaboration<Pi> =>
	match(fnType)
		.with({ type: "Modal" }, ({ value }) => {
			console.warn("Inferred fn as a modal type. Still unsure what to do here. Simply unwrapping the modality for now");
			return mkPi(value, icit);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
			if (pi.binder.icit !== icit) {
				throw new Error("Implicitness mismatch");
			}

			return M.of<Pi>([pi.binder.annotation, pi.closure, pi.binder.variable]);
		})
		.otherwise(function* () {
			const ctx = yield* M.reader.ask();

			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const nf = yield* NF.normalize(meta);

			const closure = NF.Constructors.Closure(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length + 1, NF.Type)));

			const pi = NF.Constructors.Pi("x", icit, nf, closure);

			yield* M.constrain({ type: "assign", left: fnType, right: pi, lvl: ctx.env.length });
			return [nf, closure, pi.binder.variable] satisfies Pi;
		});
