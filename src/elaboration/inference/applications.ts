import * as EB from "@yap/elaboration";

import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";
import { Implicitness } from "@yap/shared/implicitness";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = (node: Application) =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Application node" } }, function* () {
		const [ft, pi, fus] = yield* callee(yield* inferFn(node), node.icit);
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

		/* Calling a field of a record under construction demands everything its body reads (OCaml's `let rec` dereference). */
		yield* match(inferred[0])
			.with(EB.CtorPatterns.Vars.NuLabel, function* ({ variable }) {
				const ctx = yield* M.reader.ask();
				yield* EB.reference(ctx, variable.index, { label: variable.name, applied: true });
			})
			.otherwise(function* () {});

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
const callee = function* ([term, type, usages]: EB.AST, icit: Implicitness): M.Elaboration<[EB.Term, Pi, EB.AST[2]]> {
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => {
			console.warn("Inferred fn as a modal type. Still unsure what to do here. Simply unwrapping the modality for now");
			return callee([term, value.value, usages], icit);
		})
		.with(NF.View.Sealed(NF.Patterns.Psi), function* ({ value: { binder, closure } }) {
			const ctx = yield* M.reader.ask();
			const argument = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.State, "State"));
			const body = yield* NF.apply(binder, closure, yield* NF.normalize(argument));
			return yield* callee(yield* EB.Icit.insert([EB.Constructors.App("Psi", term, argument), body, usages]), icit);
		})
		.with(NF.View.Sealed(NF.Patterns.Pi), ({ value: pi }) => {
			if (pi.binder.icit !== icit) {
				throw new Error("Implicitness mismatch");
			}
			return M.of([term, [pi.binder.annotation, pi.closure, pi.binder.variable], usages] satisfies [EB.Term, Pi, EB.AST[2]]);
		})
		.otherwise(function* () {
			const ctx = yield* M.reader.ask();
			const scoped = icit === "Explicit" ? EB.bind(ctx, { type: "Psi", variable: "$s" }, NF.State, "inserted") : ctx;
			const annotation = NF.Constructors.Flex(yield* EB.freshMeta(scoped.env.length, NF.Type));
			const closure = NF.Constructors.Closure(scoped, EB.Constructors.Var(yield* EB.freshMeta(scoped.env.length + 1, NF.Type)));
			const pi = NF.Constructors.Pi("x", icit, annotation, closure);
			const expected = icit === "Explicit" ? NF.Constructors.Psi("$s", undefined, yield* NF.closeVal(pi)) : pi;
			yield* M.constrain({ type: "assign", left: type, right: expected, lvl: ctx.env.length });
			return yield* callee([term, expected, usages], icit);
		});
};
