import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import fp from "lodash/fp";
import * as F from "fp-ts/function";

import { Subst } from "../unification/substitution";

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
		const agreed = solutions.every(value => isEqual(value, solutions[0]));
		return agreed && solutions[0] ? solve(merged, entry.meta.val, solutions[0]) : merged;
	}, base);
};

export const fresh = function* (lvl: number, annotation: NF.Value): V2.Gelaboration<EB.Meta> {
	const meta = yield* V2.gets(st => st.fresh.meta + 1);
	const value: EB.Meta = { type: "Meta", val: meta, lvl };
	yield* V2.modify(st => ({
		...st,
		fresh: { ...st.fresh, meta },
		metas: register(st.metas, { meta: value, annotation }),
	}));
	return value;
};

type MetaNF = Extract<NF.Variable, { type: "Meta" }>;

export const collectMetasNF = (val: NF.Value, zonker: Subst): MetaNF[] => {
	const ms = match(val)
		.with(NF.Patterns.Lit, () => [])
		.with(NF.Patterns.Flex, ({ variable }) => {
			if (!zonker[variable.val]) {
				return [variable];
			}
			return collectMetasNF(zonker[variable.val], zonker);
		})
		.with(NF.Patterns.Var, () => [])
		.with(NF.Patterns.App, ({ func, arg }) => [...collectMetasNF(func, zonker), ...collectMetasNF(arg, zonker)])
		.with(NF.Patterns.Proj, ({ base }) => collectMetasNF(base, zonker))
		.with(NF.Patterns.Match, ({ closure, scrutinee }) => [...collectMetasNF(scrutinee, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Inj, ({ base, injected }) => [...collectMetasNF(base, zonker), ...collectMetasNF(injected, zonker)])
		.with(NF.Patterns.Row, ({ row }) =>
			R.fold(
				row,
				(val, l, ms) => ms.concat(collectMetasNF(val, zonker)),
				(v, ms) => {
					if (v.type !== "Meta") {
						return ms;
					}

					if (!zonker[v.val]) {
						return [v, ...ms];
					}

					return ms.concat(collectMetasNF(zonker[v.val], zonker));
				},
				[] as MetaNF[],
			),
		)
		.with({ type: "Neutral" }, ({ value }) => collectMetasNF(value, zonker))
		.with(NF.Patterns.Lambda, ({ closure }) => collectMetasEB(closure.term, zonker))
		.with(NF.Patterns.Pi, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Mu, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Sigma, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Modal, ({ value }) => collectMetasNF(value, zonker))
		.with(NF.Patterns.External, ({ args }) => args.flatMap(arg => collectMetasNF(arg, zonker)))
		.otherwise(() => {
			throw new Error("metas: Not implemented yet");
		});

	return F.pipe(
		ms,
		fp.uniqBy(m => m.val),
	);
};

type MetaEB = Extract<EB.Variable, { type: "Meta" }>;
export const collectMetasEB = (tm: EB.Term, zonker: Subst): MetaEB[] => {
	const _metas = (tm: EB.Term): MetaEB[] => {
		const ms = match(tm)
			.with({ type: "Var" }, ({ variable }) => {
				if (variable.type !== "Meta") {
					return [];
				}

				if (!zonker[variable.val]) {
					return [variable];
				}

				return collectMetasNF(zonker[variable.val], zonker);
			})
			.with({ type: "Lit" }, () => [])
			.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body }) => _metas(body))
			.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)])
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)])
			.with({ type: "Abs", binding: { type: "Sigma" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)])
			.with({ type: "App" }, ({ func, arg }) => [..._metas(func), ..._metas(arg)])
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(val, l, ms) => ms.concat(_metas(val)),
					(v, ms) => {
						if (v.type !== "Meta") {
							return ms;
						}
						if (!zonker[v.val]) {
							return [...ms, v];
						}
						return ms.concat(collectMetasNF(zonker[v.val], zonker));
					},
					[] as MetaEB[],
				),
			)
			.with({ type: "Proj" }, ({ term }) => _metas(term))
			.with({ type: "Inj" }, ({ value, term }) => [..._metas(value), ..._metas(term)])
			.with({ type: "Ann" }, ({ term, ann }) => [..._metas(term), ..._metas(ann)])
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => [..._metas(scrutinee), ...alternatives.flatMap(alt => _metas(alt.term))])
			.with({ type: "Block" }, ({ return: ret, statements }) => [..._metas(ret), ...statements.flatMap(s => _metas(s.value))])
			.with({ type: "Modal" }, ({ term }) => _metas(term))
			.with({ type: "Shift" }, ({ body }) => _metas(body))
			.with({ type: "Bubble" }, ({ shift }) => _metas(shift))
			.with({ type: "Reset" }, ({ term }) => _metas(term))
			.otherwise(() => {
				throw new Error("metas: Not implemented yet");
			});

		return ms;
	};
	return _metas(tm);
};

export const Annotations = {
	closeOver: (ctx: EB.Context, seeds: readonly MetaNF[]): readonly MetaNF[] => {
		// A pass over the collected metas rather than inlining into the collectors' Meta cases:
		// those take (val, zonker), and threading ctx.metas through them to reach annotations is annoying.
		type Acc = readonly [ReadonlySet<number>, readonly MetaNF[]];
		const go = ([seen, out]: Acc, m: MetaNF): Acc =>
			match(seen.has(m.val))
				.with(true, (): Acc => [seen, out])
				.otherwise((): Acc => {
					const anns = match(ctx.metas[m.val])
						.with(P.nullish, (): readonly MetaNF[] => [])
						.otherwise(entry => collectMetasNF(entry.ann, ctx.zonker));
					const [seen2, out2] = anns.reduce<Acc>(go, [new Set([...seen, m.val]), out]);
					return [seen2, [...out2, m]];
				});
		return seeds.reduce<Acc>(go, [new Set<number>(), []])[1];
	},
};

export const collect = {
	nf: collectMetasNF,
	eb: collectMetasEB,
};
