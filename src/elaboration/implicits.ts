import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";

import { match, P } from "ts-pattern";

import _ from "lodash";
import { Subst } from "./unification/substitution";

import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";
import assert from "assert";

export function insert(node: EB.AST): V2.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return V2.Do(function* () {
		const ctx = yield* V2.ask();
		const r = match(node)
			//.with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => V2.of<EB.AST>(node))
			.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) =>
				V2.Do(function* () {
					// const found = yield* V2.pure(EB.resolveImplicit(pi.binder.annotation));

					// if (found) {
					// 	if (!_.isEmpty(found[1])) {
					// 		throw new Error("insert: Found implicit with constraints; What to do here?");
					// 	}
					// 	const bodyNF = NF.apply(pi.binder, pi.closure, pi.binder.annotation);
					// 	const tm = EB.Constructors.App("Implicit", term, found[0]);
					// 	return [tm, bodyNF, us] satisfies EB.AST;
					// }
					const meta = yield* EB.freshMeta(ctx.env.length, pi.binder.annotation);
					const mvar = EB.Constructors.Var(meta);
					const vNF = NF.evaluate(ctx, mvar);

					const tm = EB.Constructors.App("Implicit", term, mvar);
					const bodyNF = NF.apply(pi.binder, pi.closure, vNF);

					yield* V2.tell("constraint", { type: "resolve", meta, value: pi.binder.annotation, implicits: ctx.implicits });

					const r = yield* insert.gen([tm, bodyNF, us]);
					return r;
				}),
			)
			.otherwise(() => V2.of<EB.AST>(node));
		return yield* V2.pure(r);
	});
}

insert.gen = F.flow(insert, V2.pure);

export const wrapLambda = (term: EB.Term, ty: NF.Value, ctx: EB.Context): EB.Term => {
	return match(ty)
		.with(
			{ type: "Abs", binder: { type: "Pi", icit: "Implicit" } },
			_ => term.type === "Abs" && (term.binding.type === "Lambda" || term.binding.type === "Pi") && term.binding.icit === "Implicit",
			_ => term,
		)
		.with({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, pi => {
			const ann = NF.quote(ctx, ctx.env.length, pi.binder.annotation);
			const binding: EB.Binding = { type: "Lambda", variable: pi.binder.variable, icit: pi.binder.icit, annotation: ann };
			return EB.Constructors.Abs(binding, wrapLambda(term, NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(0)), ctx));
		})
		.otherwise(() => term);
};

export const generalize = (tm: EB.Term, ctx: EB.Context): EB.Term => {
	const ms = Metas.collect.eb(tm, ctx.zonker);
	const charCode = 97; // 'a'
	return ms.reduce(
		(tm, m, i) => {
			return EB.Constructors.Abs(
				{
					type: "Lambda",
					icit: "Implicit",
					variable: `${String.fromCharCode(charCode + i)}`,
					annotation: NF.quote(ctx, ctx.env.length, ctx.metas[m.val].ann),
				},
				tm,
			);
		},
		tm, //replaceMeta(tm, ms, 0, ctx),
	);
};

// TODO: We might want to remove this pass altogether in the future. Perhaps merge it with a lowering pass.
/**
 * Instantiates unconstrained meta variables in a Term to default values based on their annotations.
 * Constrained metas (those that have been unified to some value) are quoted from the zonker.
 * Resolved metas (those from implicit resolution) are replaced by their resolved terms.
 * NOTE: this is more zonking than instantiation, but the name is kept for legacy reasons.
 */
export const instantiate = (term: EB.Term, ctx: EB.Context, resolutions: EB.Resolutions): EB.Term => {
	return (
		match(term)
			.with({ type: "Var", variable: { type: "Meta" } }, v => {
				// Don't instantiate metas from outer scopes - they should remain unsolved
				// and will be handled at their original scope level
				if (v.variable.lvl < ctx.env.length) {
					return v;
				}

				if (resolutions[v.variable.val]) {
					return resolutions[v.variable.val];
				}

				if (!!ctx.zonker[v.variable.val]) {
					const quoted = NF.quote(ctx, ctx.env.length, ctx.zonker[v.variable.val]);
					// we still need to instantiate in case the quoted term has metas itself
					return instantiate(quoted, ctx, resolutions);
				}

				const { ann } = ctx.metas[v.variable.val];

				return match(ann)
					.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => EB.Constructors.Row({ type: "empty" }))
					.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Any" }))
					.with({ type: "Lit", value: { type: "Atom", value: "Any" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Void" }))
					.otherwise(() => EB.Constructors.Var(v.variable));
			})
			.with({ type: "Abs", binding: { type: "Sigma" } }, sig => {
				const annotation = instantiate(sig.binding.annotation, ctx, resolutions);
				const nf = NF.evaluate(ctx, annotation);
				assert(nf.type === "Row", "Sigma binder annotation must be a Row");
				const xtended = EB.extendSigmaEnv(ctx, nf.row);
				return EB.Constructors.Abs({ ...sig.binding, annotation }, instantiate(sig.body, xtended, resolutions));
			})
			.with({ type: "Abs" }, abs => {
				const annotation = instantiate(abs.binding.annotation, ctx, resolutions);
				const extended = EB.bind(ctx, abs.binding, NF.evaluate(ctx, annotation));
				return EB.Constructors.Abs({ ...abs.binding, annotation }, instantiate(abs.body, extended, resolutions));
			})
			.with({ type: "App" }, app => EB.Constructors.App(app.icit, instantiate(app.func, ctx, resolutions), instantiate(app.arg, ctx, resolutions)))
			.with({ type: "Row" }, ({ row }) => {
				const r = R.traverse(
					row,
					val => instantiate(val, ctx, resolutions),
					v => R.Constructors.Variable(v),
				);
				return EB.Constructors.Row(r);
			})
			.with({ type: "Proj" }, ({ label, term }) => EB.Constructors.Proj(label, instantiate(term, ctx, resolutions)))
			.with({ type: "Inj" }, ({ label, value, term }) => EB.Constructors.Inj(label, instantiate(value, ctx, resolutions), instantiate(term, ctx, resolutions)))
			//.with({ type: "Annotation" }, ({ term, ann }) => EB.Constructors.Annotation(instantiate(term, ctx), instantiate(ann, ctx)))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
				EB.Constructors.Match(
					instantiate(scrutinee, ctx, resolutions),
					alternatives.map(alt => {
						const xtended = alt.binders.reduce((acc, [bv, bty]) => EB.bind(acc, { type: "Let", variable: bv }, bty), ctx);
						return { pattern: alt.pattern, term: instantiate(alt.term, xtended, resolutions), binders: alt.binders };
					}),
				),
			)
			.with({ type: "Block" }, ({ return: ret, statements }) => {
				const { stmts, ctx: xtended } = statements.reduce(
					(acc, s) => {
						const { stmts, ctx } = acc;

						if (s.type === "Let") {
							const extended = EB.bind(ctx, { type: "Let", variable: s.variable }, s.annotation);
							const instantiated = { ...s, value: instantiate(s.value, ctx, resolutions) };
							return { stmts: [...stmts, instantiated], ctx: extended };
						}
						const instantiated = { ...s, value: instantiate(s.value, ctx, resolutions) };
						return { stmts: [...stmts, instantiated], ctx };
					},
					{ stmts: [] as EB.Statement[], ctx },
				);

				return EB.Constructors.Block(stmts, instantiate(ret, xtended, resolutions));
			})
			.with({ type: "Modal" }, ({ term, modalities }) => EB.Constructors.Modal(instantiate(term, ctx, resolutions), modalities))
			.otherwise(t => t)
	);

	// return EB.traverse(term, v => {
	// 	if (v.variable.type !== "Meta") {
	// 		return v;
	// 	}

	// 	if (!!ctx.zonker[v.variable.val]) {
	// 		// Solved meta means it's in the zonker = not unconstrained, so no need to instantiate it
	// 		return NF.quote(ctx, ctx.env.length, ctx.zonker[v.variable.val]);
	// 	}

	// 	const { ann } = ctx.metas[v.variable.val];

	// 	return match(ann)
	// 		.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => EB.Constructors.Row({ type: "empty" }))
	// 		.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Any" }))
	// 		.with({ type: "Lit", value: { type: "Atom", value: "Any" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Void" }))
	// 		.otherwise(() => EB.Constructors.Var(v.variable));
	// });
};
