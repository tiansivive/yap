import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import * as Q from "@yap/shared/modalities/multiplicity";

import fp from "lodash/fp";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";
import { set } from "@yap/utils";
import { Subst } from "../unification/substitution";
import { Liquid } from "@yap/verification/modalities";

type Meta = Extract<NF.Variable, { type: "Meta" }>;
export const metas = (val: NF.Value, zonker: Subst): Meta[] => {
	const ms = match(val)
		.with(NF.Patterns.Lit, () => [])
		.with(NF.Patterns.Flex, ({ variable }) => {
			if (!zonker[variable.val]) {
				return [variable];
			}
			return metas(zonker[variable.val], zonker);
		})
		.with(NF.Patterns.Var, () => [])
		.with(NF.Patterns.App, ({ func, arg }) => [...metas(func, zonker), ...metas(arg, zonker)])
		.with(NF.Patterns.Row, ({ row }) =>
			R.fold(
				row,
				(val, l, ms) => ms.concat(metas(val, zonker)),
				(v, ms) => {
					if (v.type !== "Meta") {
						return ms;
					}

					if (!zonker[v.val]) {
						return [v, ...ms];
					}

					return metas(zonker[v.val], zonker);
				},
				[] as Meta[],
			),
		)
		.with({ type: "Neutral" }, ({ value }) => metas(value, zonker))
		.with(NF.Patterns.Lambda, ({ closure }) => EB.Icit.metas(closure.term, zonker))
		.with(NF.Patterns.Pi, ({ closure, binder }) => [...metas(binder.annotation.nf, zonker), ...EB.Icit.metas(closure.term, zonker)])
		.with(NF.Patterns.Mu, ({ closure, binder }) => [...metas(binder.annotation.nf, zonker), ...EB.Icit.metas(closure.term, zonker)])
		.otherwise(() => {
			throw new Error("metas: Not implemented yet");
		});

	return F.pipe(
		ms,
		fp.uniqBy(m => m.val),
	);
};

/**
 * Generalizes a value by replacing meta variables with bound variables, which are introduced by wrapping the value in a Pi type for each meta variable.
 */
export const generalize = (val: NF.Value, ctx: EB.Context): [NF.Value, EB.Context] => {
	const ms = metas(val, ctx.zonker);

	if (ms.length === 0) {
		return [val, ctx];
	}

	const charCode = "a".charCodeAt(0);

	// Build a single closure context that has all generalized metas mapped to the corresponding bound variables.
	// We also pre-extend names/types/env so quoting inside closures sees the right level indices.
	const extendedCtx = ms.reduce((acc, m, i) => {
		const name = `${String.fromCharCode(charCode + i)}`;
		const boundLvl = i; // outermost binder is level 0 when quoting with lvl = ms.length
		const { ann } = ctx.metas[m.val];
		const withBinder = EB.bind(
			acc,
			{ type: "Pi", variable: name },
			{ nf: ann, modalities: { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF() } },
			"inserted",
		);
		return set(withBinder, ["zonker", `${m.val}`] as const, NF.Constructors.Var({ type: "Bound", lvl: boundLvl }));
	}, ctx);

	// Wrap from inner to outer. Each Pi body is quoted with lvl equal to the number of binders in scope.
	const generalized = A.reverse(ms).reduce<NF.Value>((body, m, i) => {
		const idx = ms.length - 1 - i; // the idx is the complement of i, since we're going from inner to outer
		const variable = String.fromCharCode(charCode + idx);
		// Quote with all binders in scope: lvl = ms.length - i
		const term = NF.quote(extendedCtx, ms.length - i, body);
		const { ann } = ctx.metas[m.val];
		return NF.Constructors.Pi(
			variable,
			"Implicit",
			{ nf: ann, modalities: { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF() } },
			NF.Constructors.Closure(extendedCtx, term),
		);
	}, val);

	// Return the extended ctx so callers can keep the zonker mapping for subsequent passes (instantiate, etc.)
	return [generalized, extendedCtx];
};

const convertMeta = (meta: Meta, ms: Meta[]): NF.Variable => {
	const i = ms.findIndex(m => m.val === meta.val);

	if (i === -1) {
		// Not a meta that we are generalizing. If it doesn't show up in the meta list, then it must be in the zonker (solved)
		return meta;
	}

	return { type: "Bound", lvl: i };
};

export const instantiate = (nf: NF.Value, subst: Subst, ctx: EB.Context): NF.Value => {
	return NF.traverse(
		nf,
		v => {
			if (v.variable.type !== "Meta") {
				return v;
			}

			if (!!subst[v.variable.val]) {
				// Solved meta means it's in the zonker = not unconstrained, so no need to instantiate it
				return v;
			}
			const { ann } = ctx.metas[v.variable.val];
			return match(ann)
				.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row({ type: "empty" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Constructors.Lit({ type: "Atom", value: "Any" }))
				.otherwise(() => NF.Constructors.Var(v.variable));
		},
		tm => EB.Icit.instantiate(tm, subst, ctx.metas),
	);
};
