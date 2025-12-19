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
	env: Array<{
		type: [Binder, Origin, NF.Value];
		nf: NF.Value;
		name: Binder;
	}>;
	implicits: Array<[EB.Term, NF.Value]>;
	sigma: Record<string, Sigma>;
	delimitations: Array<{ answer: { initial: NF.Value; final: NF.Value } }>;

	zonker: Sub.Subst;
	metas: Record<number, { meta: EB.Meta; ann: NF.Value }>;
	imports: Record<string, EB.AST>;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	trace: P.Stack<Provenance>;
};

export type Zonker = Context["zonker"];

export type Sigma = { term: EB.Term; nf: NF.Value; ann: NF.Value; multiplicity: Q.Multiplicity; isAnnotation?: boolean };

export type Binder = Pick<EB.Binding, "type" | "variable">;

export const lookup = (variable: Src.Variable, ctx: Context): V2.Elaboration<EB.AST> => {
	const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
	// labels are different syntax (:varname), so we can check them before bound variables as the latter will never shadow the former
	if (variable.type === "label") {
		const key = ctx.sigma[variable.value];
		if (key) {
			const { ann, multiplicity, isAnnotation, nf } = key;
			const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
			// // if it's an annotation, then the field value describes the type of the field
			// // if it's a value, the the field's type is given by the stored ann
			// const ty = isAnnotation ? nf : ann;
			return V2.of<EB.AST>([tm, nf, zeros]); // QUESTION: need to somehow handle multiplicity?
		}
		throw new Error(`Label not found: ${variable.value}`);
	}

	const _lookup = (i: number, variable: Src.Variable, types: Array<Context["env"][number]["type"]>): V2.Elaboration<EB.AST> => {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;

				const tm = EB.Constructors.Var({ type: "Free", name: variable.value });
				return V2.of<EB.AST>([tm, nf, Q.add(us, zeros)]); //QUESTION: is this addition correct?
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, origin, nf], ...rest] = types;
		//const usages = []//unsafeUpdateAt(i, modalities.quantity, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return V2.Do(function* () {
				yield* V2.tell("binder", binder);
				return [tm, nf, zeros] as EB.AST;
			});
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(
		0,
		variable,
		ctx.env.map(v => v.type),
	);
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

export const bind = (context: Context, binder: Binder, annotation: NF.Value, origin: Origin = "source"): Context => {
	const { env } = context;
	const entry: Context["env"][number] = {
		nf: NF.Constructors.Rigid(env.length),
		type: [binder, origin, annotation],
		name: binder,
	};

	return {
		...context,
		env: [entry, ...env],
	};
};

export const extend = (context: Context, binder: Binder, value: NF.Value, origin: Origin = "source"): Context => {
	const { env } = context;

	const entry: Context["env"][number] = {
		nf: value,
		type: [binder, origin, new Error("Need to implemented typed metas: Get the type from metas context") as any],
		name: binder,
	};
	return {
		...context,
		env: [entry, ...env],
	};
};

export const extendSigmaEnv = (ctx: Context, row: NF.Row): Context => {
	const collect = (r: NF.Row): Context["sigma"] => {
		if (r.type === "empty") {
			return {};
		}

		if (r.type === "variable") {
			return {};
		}

		const fieldSigma: Context["sigma"] = {
			[r.label]: {
				term: new Error("Dont think I need this") as any,
				nf: r.value,
				ann: new Error("Same problem as normal extend above. Must pass val annotation in apply/extend to fix this") as any,
				multiplicity: Q.Many,
			},
			...collect(r.row),
		};

		return fieldSigma;
	};

	return update(ctx, "sigma", s => ({
		...s,
		...collect(row),
	}));
};

export const augment = (context: Context, binder: Binder, annotation: NF.Value, origin: Origin = "inserted") => {
	const { env } = context;
	const entry: Context["env"][number] = {
		nf: NF.Constructors.Rigid(env.length),
		type: [binder, origin, annotation],
		name: binder,
	};

	return {
		...context,
		env: [...env, entry],
	};
};

export const unfoldMu = (context: Context, binder: Binder, annotation: NF.Value, origin: Origin = "source"): Context => {
	const { env } = context;
	const entry: Context["env"][number] = {
		nf: annotation, // NOTE: mu types are directly placed in the env
		type: [binder, origin, annotation],
		name: binder,
	};
	return {
		...context,
		env: [entry, ...env],
	};
};

export const extendSigma = (ctx: Context, variable: string, sigma: Sigma, isAnnotation = false): Context => {
	return set(ctx, ["sigma", variable] as const, { ...sigma, isAnnotation });
};

export const muContext = (ctx: Context): Context => {
	return {
		...ctx,
		env: ctx.env.map((e): Context["env"][number] => {
			const [b, ...rest] = e.type;
			if (b.type === "Let") {
				return { ...e, type: [{ ...b, type: "Mu" }, ...rest] };
			}
			return e;
		}),
	};
};

export const prune = (ctx: Context, lvl: number): Context => {
	return update(ctx, "env", A.takeRight(lvl));
};

export const lvl2idx = (ctx: Context, lvl: number): number => {
	return ctx.env.length - 1 - lvl;
};
