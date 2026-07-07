import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import fp from "lodash/fp";
import * as F from "fp-ts/function";

import { Subst } from "../unification/substitution";

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
