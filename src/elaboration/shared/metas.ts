import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import fp from "lodash/fp";
import * as F from "fp-ts/function";

import * as Eff from "@yap/utils/effects";

import * as Sub from "../unification/substitution";
import * as M from "./effects";

/**
 * The authoritative metacontext.  A meta's syntax, annotation, and eventual
 * semantic solution move together so consumers cannot accidentally observe
 * different versions of those three facts.
 */
export type Entry = {
	meta: EB.Meta;
	annotation: NF.Value;
	solution?: NF.Value;
};

export type Registry = Readonly<Record<number, Entry>>;

export const empty: Registry = {};

export const lookup = (metas: Registry, id: number): Entry | undefined => metas[id];

export const solution = (metas: Registry, id: number): NF.Value | undefined => metas[id]?.solution;

export const solutions = (metas: Registry): Sub.Subst =>
	Sub.from(Object.fromEntries(Object.values(metas).flatMap(entry => (entry.solution ? [[entry.meta.val, entry.solution]] : []))));

export const withSolutions = (metas: Registry, subst: Sub.Subst): Registry =>
	Object.entries(subst).reduce((entries, [id, value]) => solve(entries, Number(id), value), metas);

export const register = (metas: Registry, entry: Entry): Registry => ({ ...metas, [entry.meta.val]: entry });

export const solve = (metas: Registry, id: number, value: NF.Value): Registry => {
	const entry = metas[id];
	if (!entry) {
		throw new Error(`Cannot solve unregistered meta ?${id}`);
	}
	return { ...metas, [id]: { ...entry, solution: value } };
};

/** Keep only facts every replay branch agrees on; candidate-local solutions stay local. */
export const merge = (base: Registry, branches: readonly Registry[]): Registry => {
	if (branches.length === 0) {
		return base;
	}
	return Object.values(base).reduce<Registry>((merged, entry) => {
		const solutions = branches.map(branch => branch[entry.meta.val]?.solution);
		const agreed = solutions.every(value => fp.isEqual(value, solutions[0]));
		return agreed && solutions[0] ? solve(merged, entry.meta.val, solutions[0]) : merged;
	}, base);
};

/*
 * The registry as an ambient capability. One instance module-wide: an
 * action's identity is its tag, so every row that mentions the registry
 * must share this one. The handler owns the cell; get/modify are the only
 * ways to observe or move it, and the pure algebra above rides in payloads.
 */
type Get = Eff.Action<"Registry.get", undefined, Registry>;
type Register = Eff.Action<"Registry.register", Entry, Registry>;
type Modify = Eff.Action<"Registry.modify", (registry: Registry) => Registry, Registry>;

const get = function* () {
	return yield* Eff.ctl.action<Get>("Registry.get", undefined);
};

/** Adds a fresh entry — minting's write, distinct from solving. Answers the registry after. */
const registerOp = function* (entry: Entry) {
	return yield* Eff.ctl.action<Register>("Registry.register", entry);
};

/** Answers with the registry after the change. */
const modify = function* (change: (registry: Registry) => Registry) {
	return yield* Eff.ctl.action<Modify>("Registry.modify", change);
};

const handlers = (initial: Registry = empty): Eff.Handler<Get | Register | Modify, Registry> => {
	/* eslint-disable no-restricted-syntax -- this handler owns the registry cell */
	let current = initial;

	return {
		clauses: {
			"Registry.get": () => Eff.ctl.resume(current),

			"Registry.register": entry => {
				current = register(current, entry);

				return Eff.ctl.resume(current);
			},

			"Registry.modify": change => {
				current = change(current);

				return Eff.ctl.resume(current);
			},
		},

		output: () => current,
	};
	/* eslint-enable no-restricted-syntax */
};

export const registry = { get, register: registerOp, modify, handlers };

/** A computation over the registry alone. */
export type Effect<A> = Eff.Eff<Eff.Actions<typeof registry>, A>;

/** Minting: a fresh id and its registration, nothing else. */
export type Minting<A> = Eff.Eff<Eff.Actions<typeof M.supply> | Eff.Only<typeof registry, "Registry.register">, A>;

export const fresh = function* (lvl: number, annotation: NF.Value): Minting<EB.Meta> {
	const id = yield* M.supply.fresh("meta");
	const meta: EB.Meta = { type: "Meta", val: id, lvl };

	yield* registry.register({ meta, annotation });

	return meta;
};

type MetaNF = Extract<NF.Variable, { type: "Meta" }>;
type MetaEB = Extract<EB.Variable, { type: "Meta" }>;

/** The collectors: get() once, both walkers close over the snapshot and recurse freely. */
export const collectors = function* (): Effect<{ nf: (val: NF.Value) => MetaNF[]; eb: (tm: EB.Term) => MetaEB[] }> {
	const metas = yield* registry.get();

	const nf = (val: NF.Value): MetaNF[] => {
		const ms = match(val)
			.with(NF.Patterns.Lit, () => [])
			.with(NF.Patterns.Flex, ({ variable }) => {
				const solved = solution(metas, variable.val);
				if (!solved) {
					return [variable];
				}
				return nf(solved);
			})
			.with(NF.Patterns.Var, () => [])
			.with(NF.Patterns.App, ({ func, arg }) => [...nf(func), ...nf(arg)])
			.with(NF.Patterns.Proj, ({ base }) => nf(base))
			.with(NF.Patterns.Match, ({ closure, scrutinee }) => [...nf(scrutinee), ...eb(closure.term)])
			.with(NF.Patterns.Inj, ({ base, injected }) => [...nf(base), ...nf(injected)])
			.with(NF.Patterns.Row, ({ row }) =>
				R.fold(
					row,
					(val, l, ms) => ms.concat(nf(val)),
					(v, ms) => {
						if (v.type !== "Meta") {
							return ms;
						}

						const solved = solution(metas, v.val);
						if (!solved) {
							return [v, ...ms];
						}

						return ms.concat(nf(solved));
					},
					[] as MetaNF[],
				),
			)
			.with({ type: "Neutral" }, ({ value }) => nf(value))
			.with(NF.Patterns.Lambda, ({ closure }) => eb(closure.term))
			.with(NF.Patterns.Pi, ({ closure, binder }) => [...nf(binder.annotation), ...eb(closure.term)])
			.with(NF.Patterns.Mu, ({ closure, binder }) => [...nf(binder.annotation), ...eb(closure.term)])
			.with(NF.Patterns.Sigma, ({ closure, binder }) => [...nf(binder.annotation), ...eb(closure.term)])
			.with(NF.Patterns.Modal, ({ value }) => nf(value))
			.with(NF.Patterns.External, ({ args }) => args.flatMap(arg => nf(arg)))
			.otherwise(() => {
				throw new Error("metas: Not implemented yet");
			});

		return F.pipe(
			ms,
			fp.uniqBy(m => m.val),
		);
	};

	const eb = (tm: EB.Term): MetaEB[] =>
		match(tm)
			.with({ type: "Var" }, ({ variable }) => {
				if (variable.type !== "Meta") {
					return [];
				}

				const solved = solution(metas, variable.val);
				if (!solved) {
					return [variable];
				}

				return nf(solved);
			})
			.with({ type: "Lit" }, () => [])
			.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body }) => eb(body))
			.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [...eb(binding.annotation), ...eb(body)])
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [...eb(binding.annotation), ...eb(body)])
			.with({ type: "Abs", binding: { type: "Sigma" } }, ({ body, binding }) => [...eb(binding.annotation), ...eb(body)])
			.with({ type: "App" }, ({ func, arg }) => [...eb(func), ...eb(arg)])
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(val, l, ms) => ms.concat(eb(val)),
					(v, ms) => {
						if (v.type !== "Meta") {
							return ms;
						}

						const solved = solution(metas, v.val);
						if (!solved) {
							return [...ms, v];
						}

						return ms.concat(nf(solved));
					},
					[] as MetaEB[],
				),
			)
			.with({ type: "Proj" }, ({ term }) => eb(term))
			.with({ type: "Inj" }, ({ value, term }) => [...eb(value), ...eb(term)])
			.with({ type: "Ann" }, ({ term, ann }) => [...eb(term), ...eb(ann)])
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => [...eb(scrutinee), ...alternatives.flatMap(alt => eb(alt.term))])
			.with({ type: "Block" }, ({ return: ret, statements }) => [...eb(ret), ...statements.flatMap(s => eb(s.value))])
			.with({ type: "Modal" }, ({ term }) => eb(term))
			.with({ type: "Shift" }, ({ body }) => eb(body))
			.with({ type: "Bubble" }, ({ shift }) => eb(shift))
			.with({ type: "Reset" }, ({ term }) => eb(term))
			.otherwise(() => {
				throw new Error("metas: Not implemented yet");
			});

	return { nf, eb };
};

export const Annotations = {
	/** Closes a set of metas over the metas appearing in their annotations, dependencies first. */
	closeOver: function* (seeds: readonly MetaNF[]): Effect<readonly MetaNF[]> {
		const metas = yield* registry.get();
		const { nf } = yield* collectors();

		// A pass over the collected metas rather than inlining into the collectors' Meta cases:
		// reaching annotations there would tangle the walkers with the registry entries.
		type Acc = readonly [ReadonlySet<number>, readonly MetaNF[]];
		const go = ([seen, out]: Acc, m: MetaNF): Acc =>
			match(seen.has(m.val))
				.with(true, (): Acc => [seen, out])
				.otherwise((): Acc => {
					const anns = match(metas[m.val])
						.with(P.nullish, (): readonly MetaNF[] => [])
						.otherwise(entry => nf(entry.annotation));
					const [seen2, out2] = anns.reduce<Acc>(go, [new Set([...seen, m.val]), out]);
					return [seen2, [...out2, m]];
				});
		return seeds.reduce<Acc>(go, [new Set<number>(), []])[1];
	},
};
