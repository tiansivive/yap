import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import * as Q from "@yap/shared/modalities/multiplicity";

import fp from "lodash/fp";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
import { Subst } from "../unification/substitution";
import { Liquid } from "@yap/verification/modalities";
import { collectMetasNF } from "../shared/metas";

type Meta = Extract<NF.Variable, { type: "Meta" }>;

/**
 * Generalizes a value by replacing meta variables with bound variables, which are introduced by wrapping the value in a Pi type for each meta variable.
 */
export const generalize = (val: NF.Value, ctx: EB.Context): [NF.Value, EB.Context] => {
	const ms = collectMetasNF(val, ctx.zonker);

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
		const withBinder = EB.bind(acc, { type: "Pi", variable: name }, ann, "inserted");
		return set(withBinder, ["zonker", `${m.val}`] as const, NF.Constructors.Var({ type: "Bound", lvl: boundLvl }));
	}, ctx);

	// Wrap from inner to outer. Each Pi body is quoted with lvl equal to the number of binders in scope.
	const generalized = A.reverse(ms).reduce<NF.Value>((body, m, i) => {
		const idx = ms.length - 1 - i; // the idx is the complement of i, since we're going from inner to outer
		const variable = String.fromCharCode(charCode + idx);
		// Quote with all binders in scope: lvl = ms.length - i
		const term = NF.quote(extendedCtx, ms.length - i, body);
		const { ann } = ctx.metas[m.val];
		return NF.Constructors.Pi(variable, "Implicit", ann, NF.Constructors.Closure(extendedCtx, term));
	}, val);

	// Return the extended ctx so callers can keep the zonker mapping for subsequent passes (instantiate, etc.)
	return [generalized, extendedCtx];
};

/**
 * Instantiates unconstrained meta variables in a Normal Form (NF) to default values based on their annotations.
 * Constrained metas (those that have been unified to some value) are left alone.
 */
export const instantiate = (nf: NF.Value, ctx: EB.Context): NF.Value => {
	return match(nf)
		.with({ type: "Var" }, v => {
			if (v.variable.type !== "Meta") {
				return v;
			}

			if (!!ctx.zonker[v.variable.val]) {
				// Solved meta means it's in the zonker = not unconstrained, so no need to instantiate it
				return v;
			}
			const { ann } = ctx.metas[v.variable.val];
			return match(ann)
				.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row({ type: "empty" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Constructors.Lit({ type: "Atom", value: "Any" }))
				.otherwise(() => NF.Constructors.Var(v.variable));
		})
		.with({ type: "Lit" }, lit => lit)
		.with(NF.Patterns.Lambda, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = EB.bind(closure.ctx, binder, ann);
			return NF.Constructors.Lambda(
				binder.variable,
				binder.icit,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended)),
				ann,
			);
		})
		.with(NF.Patterns.Pi, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = EB.bind(closure.ctx, binder, ann);
			return NF.Constructors.Pi(
				binder.variable,
				binder.icit,
				ann,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended)),
			);
		})
		.with(NF.Patterns.Mu, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = EB.bind(closure.ctx, binder, ann);
			return NF.Constructors.Mu(
				binder.variable,
				binder.source,
				ann,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended)),
			);
		})
		.with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(instantiate(func, ctx), instantiate(arg, ctx), icit))
		.with({ type: "Row" }, ({ row }) =>
			NF.Constructors.Row(
				R.traverse(
					row,
					v => instantiate(v, ctx),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(instantiate(value, ctx)))
		.with(NF.Patterns.Modal, ({ value, modalities }) =>
			NF.Constructors.Modal(instantiate(value, ctx), {
				quantity: modalities.quantity,
				liquid: EB.Icit.instantiate(modalities.liquid, ctx),
			}),
		)
		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
};
