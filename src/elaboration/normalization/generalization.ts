import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import * as Q from "@yap/shared/modalities/multiplicity";

import fp from "lodash/fp";
import * as F from "fp-ts/function";
import { set } from "@yap/utils";

type Meta = Extract<NF.Variable, { type: "Meta" }>;
export const metas = (val: NF.Value): Meta[] => {
	const ms = match(val)
		.with(NF.Patterns.Lit, () => [])
		.with(NF.Patterns.Flex, ({ variable }) => [variable])
		.with(NF.Patterns.Var, () => [])
		.with(NF.Patterns.App, ({ func, arg }) => [...metas(func), ...metas(arg)])
		.with(NF.Patterns.Row, ({ row }) =>
			R.fold(
				row,
				(val, l, ms) => ms.concat(metas(val)),
				(v, ms) => (v.type === "Meta" ? [...ms, v] : ms),
				[] as Meta[],
			),
		)
		.with({ type: "Neutral" }, ({ value }) => metas(value))
		.with(NF.Patterns.Lambda, ({ closure }) => EB.Icit.metas(closure.term))
		.with(NF.Patterns.Pi, ({ closure, binder }) => [...metas(binder.annotation[0]), ...EB.Icit.metas(closure.term)])
		.with(NF.Patterns.Mu, ({ closure, binder }) => [...metas(binder.annotation[0]), ...EB.Icit.metas(closure.term)])
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
export const generalize = (val: NF.Value, ctx: EB.Context): NF.Value => {
	const ms = metas(val);
	const charCode = "a".charCodeAt(0);

	const ctx_ = ms.reduce((ctx, m, i) => {
		const name = `${String.fromCharCode(charCode + i)}`;
		return EB.bind(ctx, { type: "Pi", variable: name }, [m.ann, Q.Many], "inserted");
	}, ctx);

	const sub = (nf: NF.Value, lvl: number): NF.Value => {
		const close = (closure: NF.Closure): NF.Closure => ({ ctx: ctx_, term: EB.Icit.replaceMeta(closure.term, ms, lvl + 1) });

		const t = match(nf)
			.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => NF.Constructors.Var(convertMeta(variable, ms)))
			.with({ type: "Var" }, () => nf)
			.with({ type: "Lit" }, () => nf)
			.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(sub(value, lvl)))
			.with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(sub(func, lvl), sub(arg, lvl), icit))
			.with(NF.Patterns.Lambda, ({ binder, closure }) => NF.Constructors.Lambda(binder.variable, binder.icit, close(closure)))
			.with(NF.Patterns.Pi, ({ binder, closure }) =>
				NF.Constructors.Pi(binder.variable, binder.icit, [sub(binder.annotation[0], lvl), binder.annotation[1]], close(closure)),
			)
			.with(NF.Patterns.Mu, ({ binder, closure }) =>
				NF.Constructors.Mu(binder.variable, binder.source, [sub(binder.annotation[0], lvl), binder.annotation[1]], close(closure)),
			)
			.with({ type: "Row" }, ({ row }) => {
				const r = R.traverse(
					row,
					val => sub(val, lvl),
					v => {
						if (v.type !== "Meta") {
							return R.Constructors.Variable(v);
						}
						return R.Constructors.Variable(convertMeta(v, ms));
					},
				);

				return NF.Constructors.Row(r);
			})
			.otherwise(() => {
				throw new Error("Generalize: Not implemented yet");
			});
		return t;
	};

	// Wraps the value in a Pi type for each meta variable
	return ms.reduce(
		(nf, m, i) => {
			const extension = ms.slice(0, ms.length - i).reduceRight<Pick<EB.Context, "env" | "names" | "types">>(
				(_ctx, _m, j) => {
					const binder: EB.Binder = { type: "Pi", variable: `pi${j}` };
					return {
						env: [[NF.Constructors.Rigid(j), Q.Many], ..._ctx.env],
						types: [[binder, "inserted", [_m.ann, Q.Many]], ..._ctx.types],
						names: [binder, ..._ctx.names],
					};
				},
				{ env: [], names: [], types: [] },
			);
			// The environment is the meta variables that have not been generalized so far.
			// We add them as rigid variables, so that their de Bruijn level points to the correct pi-binding
			const extended = F.pipe(ctx, set("env", extension.env), set("types", extension.types), set("names", extension.names));

			return NF.Constructors.Pi(`${String.fromCharCode(charCode + ms.length - 1 - i)}`, "Implicit", [m.ann, Q.Many], {
				ctx: extended,
				// We need an offset to account for the already generalized variables
				term: NF.quote(ctx_, ms.length - i, nf),
			});
		},
		sub(val, ms.length),
	);
};

const convertMeta = (meta: Meta, ms: Meta[]): NF.Variable => {
	const i = ms.findIndex(m => m.val === meta.val);

	if (i === -1) {
		throw new Error("Generalize: Meta not found");
	}

	return { type: "Bound", lvl: i };
};
