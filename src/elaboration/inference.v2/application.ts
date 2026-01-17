import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/normalization";
import * as M from "@yap/monad";

import * as F from "fp-ts/lib/function";
import * as tmp from "./tmp";
import { Implicitness } from "@yap/shared/implicitness";
import { match } from "ts-pattern";

type Application = Extract<CST.Types.SyntaxNode, { type: "application" }>;

export const infer = (node: Application) =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Application node" } },
		M.Do(function* () {
			const ctx = yield* M.ask();

			const { argument: spine, function: fn } = CST.Utils.extractFields(node, "function", ["argument"]);

			// Infer the function with the first argument's implicitness
			const icit0: Implicitness = Boolean(spine[0].childForFieldName("explicit")) ? "Explicit" : "Implicit";
			let [tm, ty] = yield* M.pure(inferFn(fn, icit0));

			// Apply each argument in the spine, building nested applications
			for (const a of spine) {
				const icit: Implicitness = Boolean(a.childForFieldName("explicit")) ? "Explicit" : "Implicit";

				const pi = yield* mkPi(NF.force(ctx, ty), icit);
				const at = yield* M.pure(checkArg(a, pi[0]));

				const [nf, cls, x] = pi;

				// TODO: Move this to the verification step
				//const rus = Q.add(fus, Q.multiply(quantity, aus));

				ty = NF.apply({ type: "Pi", variable: x }, cls, NF.evaluate(ctx, at));
				tm = EB.Constructors.App(icit, tm, at);
			}

			return [tm, ty] satisfies tmp.Typing;
		}),
	);
infer.gen = F.flow(infer, M.pure);

const inferFn = (node: CST.Types.SyntaxNode, icit: Implicitness) =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "inferring function type" } },
		M.Do(function* () {
			const inferred = yield* tmp.infer(node);

			if (icit === "Explicit") {
				return inferred;
			}

			const [tm, ty] = yield* EB.Icit.insert.gen(inferred);
			return [tm, ty] satisfies tmp.Typing;
		}),
	);

type Pi = [NF.Value, NF.Closure, string];
const mkPi = (fnType: NF.Value, icit: Implicitness): Generator<M.Elaboration<any>, Pi, any> =>
	match(fnType)
		.with({ type: "Modal" }, ({ value }) => {
			console.warn("Inferred fn as a modal type. Still unsure what to do here. Simply unwrapping the modality for now");
			return mkPi(value, icit);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
			if (pi.binder.icit !== icit) {
				throw new Error("Implicitness mismatch");
			}

			return M.lift<Pi>([pi.binder.annotation, pi.closure, pi.binder.variable]);
		})
		.otherwise(function* () {
			const ctx = yield* M.ask();

			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const nf = NF.evaluate(ctx, meta);

			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const closure = NF.Constructors.Closure(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length + 1, NF.Type)));

			const pi = NF.Constructors.Pi("x", icit, nf, closure);

			yield* M.tell("constraint", { type: "assign", left: fnType, right: pi, lvl: ctx.env.length });
			return [nf, closure, pi.binder.variable] satisfies Pi;
		});

const checkArg = (node: CST.Types.SyntaxNode, type: NF.Value) =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "checking", against: type, description: "checking argument type" } },
		M.Do(() => tmp.check(node, type)),
	);
