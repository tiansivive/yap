import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

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

					return collectMetasNF(zonker[v.val], zonker);
				},
				[] as MetaNF[],
			),
		)
		.with({ type: "Neutral" }, ({ value }) => collectMetasNF(value, zonker))
		.with(NF.Patterns.Lambda, ({ closure }) => collectMetasEB(closure.term, zonker))
		.with(NF.Patterns.Pi, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Mu, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)])
		.with(NF.Patterns.Modal, ({ value }) => collectMetasNF(value, zonker))
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
			.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => _metas(body))
			.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [...collectMetasNF(binding.annotation, zonker), ..._metas(body)])
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [...collectMetasNF(binding.annotation, zonker), ..._metas(body)])
			.with({ type: "App" }, ({ func, arg }) => [..._metas(func), ..._metas(arg)])
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(val, l, ms) => ms.concat(_metas(val)),
					(v, ms) => (v.type === "Meta" ? [...ms, v] : ms),
					[] as MetaEB[],
				),
			)
			.with({ type: "Proj" }, ({ term }) => _metas(term))
			.with({ type: "Inj" }, ({ value, term }) => [..._metas(value), ..._metas(term)])
			//.with({ type: "Annotation" }, ({ term, ann }) => [..._metas(term), ..._metas(ann)])
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => [..._metas(scrutinee), ...alternatives.flatMap(alt => _metas(alt.term))])
			.with({ type: "Block" }, ({ return: ret, statements }) => [..._metas(ret), ...statements.flatMap(s => _metas(s.value))])
			.with({ type: "Modal" }, ({ term }) => _metas(term))
			.otherwise(() => {
				throw new Error("metas: Not implemented yet");
			});

		return ms;
	};
	return _metas(tm);
};

export const collect = {
	nf: collectMetasNF,
	eb: collectMetasEB,
};
