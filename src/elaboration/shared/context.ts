import { replicate, unsafeUpdateAt } from "fp-ts/lib/Array";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Src from "@yap/src/index";
import * as P from "@yap/shared/provenance";

import * as U from "@yap/elaboration/unification/index";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as F from "fp-ts/function";
import * as E from "fp-ts/Either";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
import { Provenance } from "./provenance";

type Origin = "inserted" | "source";

export type Context = {
	types: Array<[Binder, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<Binder>;
	implicits: Array<[EB.Term, NF.Value]>;
	sigma: Record<string, Sigma>;
	imports: Record<string, AST>;
	trace: P.Stack<Provenance>;
	zonker: Sub.Subst;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	metas: Record<number, { meta: EB.Meta; ann: NF.Value }>;
};

export type Zonker = Context["zonker"];

export type AST = [EB.Term, NF.Value, Q.Usages];
export type Sigma = { nf: NF.Value; ann: NF.Value; multiplicity: Q.Multiplicity };

export type WithProvenance<T extends object> = T & { trace: Provenance[] };

export type Binder = Pick<EB.Binding, "type" | "variable">;

export const lookup = (variable: Src.Variable, ctx: Context): V2.Elaboration<AST> => {
	const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
	// labels are different syntax (:varname), so we can check them before bound variables as the latter will never shadow the former
	if (variable.type === "label") {
		const key = ctx.sigma[variable.value];
		if (key) {
			const { ann, multiplicity } = key;
			const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
			return V2.of<AST>([tm, ann, zeros]); // QUESTION: need to somehow handle multiplicity?
		}
		throw new Error(`Label not found: ${variable.value}`);
	}

	const _lookup = (i: number, variable: Src.Variable, types: Context["types"]): V2.Elaboration<AST> => {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;

				const tm = EB.Constructors.Var({ type: "Free", name: variable.value });
				return V2.of<AST>([tm, nf, Q.add(us, zeros)]); //QUESTION: is this addition correct?
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, origin, [nf, m]], ...rest] = types;
		const usages = unsafeUpdateAt(i, m, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return V2.Do(function* () {
				yield* V2.tell("binder", binder);
				return [tm, nf, usages] as AST;
			});
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};
lookup.gen = F.flow(lookup, V2.pure);

export const resolveImplicit = (nf: NF.Value): V2.Elaboration<[EB.Term, Sub.Subst] | void> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();

		const lookup = (implicits: Context["implicits"]): [EB.Term, Sub.Subst] | void => {
			if (implicits.length === 0) {
				return;
			}

			const [[term, value], ...rest] = implicits;
			const unification = U.unify(nf, value, ctx.env.length, Sub.empty);
			const result = unification(ctx).result;

			if (E.isRight(result)) {
				return [term, result.right];
			}
			return lookup(rest);
		};

		return lookup(ctx.implicits);
	});
resolveImplicit.gen = F.flow(resolveImplicit, V2.pure);

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

export const extend = (context: Context, binder: Binder, value: NF.ModalValue, origin: Origin = "source"): Context => {
	const { env, types } = context;
	return {
		...context,
		env: [value, ...env],
		types: [[binder, origin, new Error("Need to implemented typed metas") as any], ...types],
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

export const prune = (ctx: Context, lvl: number): Context => {
	return F.pipe(ctx, update("env", A.takeRight(lvl)), update("types", A.takeRight(lvl)), update("names", A.takeRight(lvl)));
};
