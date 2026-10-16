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

	/** Nu frames, newest first, indexed by `$label` references independently of `env`. */
	local: Frame[];
	imports: Record<string, EB.AST>;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	trace: P.Stack<Provenance>;
};

/**
 * A Nu's field scope. `ctx` is where the record was defined, without this frame. A label in `labels`
 * missing from `terms` has not been elaborated yet, or is held symbolic while quoting.
 * `types` holds the evaluated type of each completed field, as an env entry holds its evaluated annotation. Only
 * elaboration reads it, so a frame entered from a binder leaves it unset.
 */
export type Frame = { labels: readonly string[]; ctx: Context; types?: NF.Row; terms: EB.Row };

/** Re-enters a frame: its fields are evaluated where the record was defined, with the frame itself in scope. */
export const enter = (frame: Frame): Context => ({ ...frame.ctx, local: [frame, ...frame.ctx.local] });

/** Enters the frame a Nu binder describes, for the record defined in `ctx`. */
export const open = ({ labels, scoped }: { labels: readonly string[]; scoped: EB.Row }, ctx: Context): Context => enter({ labels, ctx, terms: scoped });

export type Binder =
	| Pick<EB.Binding, "type" | "variable">
	| { type: "Pattern"; variable: string }
	| { type: "Continuation"; variable: string; resumption: { meta: EB.Meta } };

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
	if (variable.type === "nu-label") {
		return yield* field(variable.value, ctx, zeros);
	}

	const _lookup = function* (i: number, variable: Src.Variable, types: Array<Context["env"][number]["type"]>): M.Elaboration<EB.AST> {
		// free vars can be shadowed by bound vars, so only if no bound vars are found do we check for free vars
		// QUESTION: should we disallow this shadowing?
		if (types.length === 0) {
			if (variable.type === "dep-label") {
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
			.otherwise(() => _lookup(i + 1, variable, rest));
	};

	return yield* _lookup(
		0,
		variable,
		ctx.env.map(v => v.type),
	);
};

export type Reference = { label: string; meta?: EB.Meta; typeMeta?: EB.Meta; guarded: boolean; applied: boolean };

/** A field not yet elaborated stands in as a fresh value meta, which the Nu boundary solves once every field has its term. */
const field = function* (name: string, ctx: Context, zeros: Q.Usages): M.Elaboration<EB.AST> {
	const index = ctx.local.findIndex(frame => frame.labels.includes(name));
	const frame = ctx.local[index];
	if (!frame) {
		throw new Error(`No enclosing record field named ${name}`);
	}

	const known = frame.types && R.lookup(frame.types, name);
	if (known) {
		yield* reference(ctx, index, { label: name, applied: false });
		return [EB.Constructors.Var(EB.Constructors.Vars.NuLabel(name, index, known)), known, zeros] satisfies EB.AST;
	}

	const typeMeta = yield* freshMeta(frame.ctx.env.length, NF.Type);
	const type = NF.Constructors.Flex(typeMeta);
	const meta = yield* freshMeta(frame.ctx.env.length, type);
	yield* reference(ctx, index, { label: name, meta, typeMeta, applied: false });

	return [EB.Constructors.Var(EB.Constructors.Vars.NuLabel(name, index, type, meta)), type, zeros] satisfies EB.AST;
};

/**
 * A reference is guarded when a lambda was entered since the record began: a binder above the frame's env.
 * A match arm runs during construction, which is why pattern variables are not Lambda binders.
 */
export const reference = (ctx: Context, index: number, item: Omit<Reference, "guarded">) =>
	M.windows.record(
		{ scope: "local", lvl: ctx.local.length - 1 - index },
		{ ...item, guarded: ctx.env.slice(0, ctx.env.length - ctx.local[index].ctx.env.length).some(({ name }) => name.type === "Lambda") },
	);

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
