import { replicate } from "fp-ts/lib/Array";
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
import { match } from "ts-pattern";
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

	labels: Record<string, NF.Value>;
	sigma: Record<string, { value: NF.Value }>;
	record: Record<string, { term?: EB.Term; value?: NF.Value }>;

	zonker: Sub.Subst;
	metas: Record<number, { meta: EB.Meta; ann: NF.Value }>;
	imports: Record<string, EB.AST>;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	trace: P.Stack<Provenance>;
};

export type Zonker = Context["zonker"];

export type Binder = Pick<EB.Binding, "type" | "variable"> | { type: "Continuation"; variable: string; resumption: { meta: EB.Meta } };

export const lookup = (variable: Src.Variable, ctx: Context): V2.Elaboration<EB.AST> => {
	const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
	if (variable.type === "label") {
		const type = ctx.labels[variable.value];
		if (type) {
			const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
			return V2.of<EB.AST>([tm, type, zeros]);
		}
		throw new Error(`Label not found: ${variable.value}`);
	}

	const _lookup = (i: number, variable: Src.Variable, types: Array<Context["env"][number]["type"]>): V2.Elaboration<EB.AST> => {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [storedTm, nf, us] = free;

				const tm = match(storedTm)
					.with({ type: "Var", variable: { type: "Foreign" } }, t => EB.Constructors.Var({ type: "Foreign", name: t.variable.name }))
					.otherwise(() => EB.Constructors.Var({ type: "Free", name: variable.value }));
				return V2.of<EB.AST>([tm, nf, Q.add(us, zeros)]);
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, _origin, nf], ...rest] = types;
		//const usages = []//unsafeUpdateAt(i, modalities.quantity, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return V2.Do(function* () {
				yield* V2.tell("binder", binder);
				return [tm, nf, zeros] satisfies EB.AST;
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
			const [{ result }] = unification(ctx);

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

export const extendSigma = (ctx: Context, row: NF.Row): Context => {
	const collect = (r: NF.Row): Context["sigma"] =>
		match(r)
			.with({ type: "empty" }, (): Context["sigma"] => ({}))
			.with({ type: "variable" }, (): Context["sigma"] => ({}))
			.with({ type: "extension" }, ({ label, value, row }): Context["sigma"] => ({
				[label]: { value },
				...collect(row),
			}))
			.exhaustive();

	return update(ctx, "sigma", s => ({ ...s, ...collect(row) }));
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

export const extendLabel = (ctx: Context, label: string, type: NF.Value): Context => set(ctx, ["labels", label] as const, type);

export const extendRecord = (ctx: Context, label: string, entry: { term?: EB.Term; value?: NF.Value }): Context => set(ctx, ["record", label] as const, entry);

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
