import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";
import { Implicitness } from "@yap/shared/implicitness";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = (node: Application) =>
	V2.track(
		["src", node, { action: "infer", description: "Application node" }],
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const [ft, fty, fus] = yield* V2.pure(inferFn(node));
			const pi = yield* mkPi(fty, node.icit);
			const [at, aus] = yield* V2.pure(checkArg(node, pi[0]));

			const [[, q], cls, x] = pi;
			const rus = Q.add(fus, Q.multiply(q, aus));

			const val = NF.apply({ type: "Pi", variable: x }, cls, NF.evaluate(ctx, at), q);
			return [EB.Constructors.App(node.icit, ft, at), val, rus] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);

const inferFn = (node: Application) =>
	V2.track(
		["src", node.fn, { action: "infer", description: "inferring function type" }],
		V2.Do(function* () {
			const inferred = yield* EB.infer.gen(node.fn);

			if (node.icit !== "Explicit") {
				return inferred;
			}

			const ast = yield* EB.Icit.insert.gen(inferred);
			return ast;
		}),
	);

const checkArg = ({ arg }: Application, ann: NF.ModalValue) =>
	V2.track(["src", arg, { action: "checking", against: ann[0], description: "checking argument type" }], EB.check(arg, ann[0]));

const mkPi = (fnType: NF.Value, icit: Implicitness) =>
	match(fnType)
		.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
			if (pi.binder.icit !== icit) {
				throw new Error("Implicitness mismatch");
			}

			return V2.lift([pi.binder.annotation, pi.closure, pi.binder.variable] as const);
		})
		.otherwise(function* () {
			const ctx = yield* V2.ask();
			const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const nf = NF.evaluate(ctx, meta);
			const mnf: NF.ModalValue = [nf, Q.Many];
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const closure = NF.Constructors.Closure(ctx, EB.Constructors.Var(EB.freshMeta(ctx.env.length + 1, kind)));

			const pi = NF.Constructors.Pi("x", icit, mnf, closure);

			yield* V2.tell("constraint", { type: "assign", left: fnType, right: pi, lvl: ctx.env.length });
			return [mnf, closure, pi.binder.variable] as const;
		});
