import { replicate, unsafeUpdateAt } from "fp-ts/lib/Array";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";

import { M } from "@yap/elaboration";

import * as Src from "@yap/src/index";
import * as P from "@yap/shared/provenance";

import * as U from "@yap/elaboration/unification/index";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as E from "fp-ts/Either";
import { set, update } from "@yap/utils";

type Origin = "inserted" | "source";

export type Context = {
	types: Array<[Binder, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<Binder>;
	implicits: Array<[EB.Term, NF.Value]>;
	sigma: Record<string, Sigma>;
	imports: Record<string, AST>;
	trace: P.Stack<Provenance>;
};

export type AST = [EB.Term, NF.Value, Q.Usages];
export type Sigma = { nf: NF.Value; ann: NF.Value; multiplicity: Q.Multiplicity };

export type Provenance =
	| ["src", Src.Term, Metadata?]
	| ["eb", EB.Term, Metadata?]
	| ["nf", NF.Value, Metadata?]
	| ["alt", Src.Alternative, Metadata?]
	| ["unify", [NF.Value, NF.Value], Metadata?];

type Metadata =
	| { action: "checking"; against: NF.Value; description?: string }
	| { action: "infer"; description?: string }
	| { action: "unification" }
	| { action: "alternative"; type: NF.Value; motive: string };

export type Binder = Pick<EB.Binding, "type" | "variable">;

export const lookup = (variable: Src.Variable, ctx: Context): M.Elaboration<AST> => {
	const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
	// labels are different syntax (:varname), so we can check them before bound variables as the latter will never shadow the former
	if (variable.type === "label") {
		const key = ctx.sigma[variable.value];
		if (key) {
			const { ann, multiplicity } = key;
			const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
			return M.of<AST>([tm, ann, zeros]); // QUESTION: need to somehow handle multiplicity?
		}
		throw new Error(`Label not found: ${variable.value}`);
	}

	const _lookup = (i: number, variable: Src.Variable, types: Context["types"]): M.Elaboration<AST> => {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;

				const tm = EB.Constructors.Var({ type: "Free", name: variable.value });
				return M.of<AST>([tm, nf, Q.add(us, zeros)]); //QUESTION: is this addition correct?
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, origin, [nf, m]], ...rest] = types;
		const usages = unsafeUpdateAt(i, m, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return M.fmap(M.tell("binder", binder), _ => [tm, nf, usages]);
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

export const resolveImplicit = (nf: NF.Value): M.Elaboration<[EB.Term, Sub.Subst] | void> => {
	return M.fmap(M.ask(), ctx => {
		const lookup = (implicits: Context["implicits"]): [EB.Term, Sub.Subst] | void => {
			if (implicits.length === 0) {
				return;
			}

			const [[term, value], ...rest] = implicits;
			const [result] = M.run(U.unify(nf, value, ctx.env.length, {}), ctx);

			if (E.isRight(result)) {
				return [term, result.right];
			}
			return lookup(rest);
		};

		return lookup(ctx.implicits);
	});
};

export const bind = (context: Context, binder: Binder, annotation: NF.ModalValue, origin: Origin = "source"): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[NF.Constructors.Rigid(env.length), q], ...env],
		types: [[binder, origin, annotation], ...types],
		names: [binder, ...context.names],
	};
};

export const unfoldMu = (context: Context, binder: Binder, annotation: NF.ModalValue, origin: Origin = "source"): Context => {
	const { env, types } = context;
	return {
		...context,
		env: [annotation, ...env], // NOTE: mu types are directly placed in the env
		types: [[binder, origin, annotation], ...types],
		names: [binder, ...context.names],
	};
};

export const extendSigma = (ctx: Context, variable: string, sigma: Sigma): Context => {
	return set(ctx, ["sigma", variable] as const, sigma);
};

export const muContext = (ctx: Context): Context => {
	return {
		...ctx,
		types: ctx.types.map(([b, ...rest]) => {
			if (b.type === "Let") {
				return [{ ...b, type: "Mu" }, ...rest];
			}
			return [b, ...rest];
		}),
	};
};
