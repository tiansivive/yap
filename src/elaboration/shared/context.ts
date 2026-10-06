import { replicate } from "fp-ts/lib/Array";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import * as M from "@yap/elaboration/shared/effects";

import * as Src from "@yap/src/index";
import * as P from "@yap/shared/provenance";

import { match } from "ts-pattern";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
import { Provenance } from "./provenance";
import { freshMeta } from "./supply";
import assert from "node:assert";

type Origin = "inserted" | "source";

export type Context = {
	env: Array<{
		type: [Binder, Origin, NF.Value];
		nf: NF.Value;
		name: Binder;
	}>;
	implicits: Array<[NF.Value, NF.Value]>;

	labels: Record<string, NF.Value>;
	sigma: Record<string, { value: NF.Value }>;
	record: Record<string, { term?: EB.Term; value?: NF.Value }>;

	/** The label stack: Nu frames, newest first, indexed by `$label` references independently of `env`. */
	local: Frame[];
	imports: Record<string, EB.AST>;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	trace: P.Stack<Provenance>;
};

/**
 * A Nu's field scope. `ctx` is where the record was defined, without this frame. A label in `labels`
 * missing from `terms` has not been elaborated yet, or is held symbolic while quoting.
 * `slots` carries each field's provisional type during elaboration.
 */
export type Frame = { labels: readonly string[]; ctx: Context; slots: Record<string, NF.Value>; terms: EB.Row };

export type Binder = Pick<EB.Binding, "type" | "variable"> | { type: "Continuation"; variable: string; resumption: { meta: EB.Meta } };

export const lookup = function* (variable: Src.Variable, ctx: Context): M.Elaboration<EB.AST> {
	const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
	if (variable.type === "label") {
		const type = ctx.labels[variable.value];
		if (type) {
			const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
			return [tm, type, zeros] satisfies EB.AST;
		}
		throw new Error(`Label not found: ${variable.value}`);
	}

	const _lookup = function* (i: number, variable: Src.Variable, types: Array<Context["env"][number]["type"]>): M.Elaboration<EB.AST> {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			if (variable.type === "dep-label" || variable.type === "nu-label") {
				throw new Error(`No enclosing record field named ${variable.value}`);
			}

			const free = ctx.imports[variable.value];
			if (free) {
				const [storedTm, nf, us] = free;

				const tm = match(storedTm)
					.with({ type: "Var", variable: { type: "Foreign" } }, t => EB.Constructors.Var({ type: "Foreign", name: t.variable.name }))
					.otherwise(() => EB.Constructors.Var({ type: "Free", name: variable.value }));
				return [tm, nf, Q.add(us, zeros)] satisfies EB.AST;
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, _origin, nf], ...rest] = types;
		//const usages = []//unsafeUpdateAt(i, modalities.quantity, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			/* A Mu-tagged binder means a type-level position (muContext): flag the open
			 * let-window at this level, if any, so its boundary sees the recursion. */
			if (binder.type === "Mu") {
				yield* M.recursion.flag(ctx.env.length - 1 - i);
			}
			return [EB.Constructors.Var({ type: "Bound", index: i }), nf, zeros] satisfies EB.AST;
		}

		/* A field reference belongs to the nearest enclosing binder that carries the label. A
		 * binder of the right kind without it is not the one, so the search continues outward.
		 * The resolved index rides in the variable, so consumers keep the choice between the
		 * symbolic label and the projection it desugars to. */
		const carries = ([{ row }, { value }]: readonly [Extract<NF.Value, { type: "Row" }>, Src.Variable, unknown]) => R.lookup(row, value) !== undefined;

		return yield* match([nf, variable, binder] as const)
			/* `&foo` denotes the sibling's *value*, whose type is unknown until the row has been
			 * elaborated — the Sigma boundary constrains this meta then. */
			.with([NF.Patterns.Row, Src.Patterns.Vars.DepLabel, EB.BindingPatterns.SigmaV2], carries, function* ([, { value }]) {
				const meta = yield* freshMeta(ctx.env.length, NF.Type);
				const annotation = NF.Constructors.Flex(meta);

				return [EB.Constructors.Var({ type: "DepLabel", name: value, index: i, annotation }), annotation, zeros] satisfies EB.AST;
			})
			/* `$foo` keeps the slot, because a ν annotation carries field types, not field values. */
			.with([NF.Patterns.Row, Src.Patterns.Vars.NuLabel, EB.BindingPatterns.Nu], carries, function* ([{ row }, { value }]) {
				const type = R.lookup(row, value);
				assert(type, "A resolved field reference must have a type in the binder's row");

				return [EB.Constructors.Var({ type: "NuLabel", name: value, index: i, annotation: type }), type, zeros] satisfies EB.AST;
			})
			.otherwise(() => _lookup(i + 1, variable, rest));
	};

	return yield* _lookup(
		0,
		variable,
		ctx.env.map(v => v.type),
	);
};

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
