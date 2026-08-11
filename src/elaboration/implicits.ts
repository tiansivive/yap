import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";

import * as Eff from "@yap/utils/effects";

import { match, P } from "ts-pattern";

import * as R from "@yap/shared/rows";
import assert from "assert";

/** Zonking resolves metas through the registry under the current scope, nothing else. */
export type Zonking<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, A>;

export function* insert(node: EB.AST): M.Elaboration<EB.AST> {
	const [term, _ty, us] = node;
	const ctx = yield* M.reader.ask();

	const r = match(node)
		.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) =>
			(function* () {
				const meta = yield* EB.freshMeta(ctx.env.length, pi.binder.annotation);
				const mvar = EB.Constructors.Var(meta);
				const vNF = yield* NF.normalize(mvar);

				const tm = EB.Constructors.App("Implicit", term, mvar);
				const bodyNF = yield* NF.apply(pi.binder, pi.closure, vNF);

				yield* M.constrain({ type: "resolve", meta, value: pi.binder.annotation, implicits: ctx.implicits });

				return yield* insert([tm, bodyNF, us]);
			})(),
		)
		.otherwise(() => M.of<EB.AST>(node));

	return yield* r;
}

export const wrapLambda = function* (term: EB.Term, ty: NF.Value): NF.Abstraction<EB.Term> {
	const ctx = yield* M.reader.ask();

	return yield* match(ty)
		.with(
			{ type: "Abs", binder: { type: "Pi", icit: "Implicit" } },
			_ => term.type === "Abs" && (term.binding.type === "Lambda" || term.binding.type === "Pi") && term.binding.icit === "Implicit",
			function* () {
				return term;
			},
		)
		.with({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, function* (pi) {
			const lvl = ctx.env.length;
			const ann = yield* NF.quote(lvl, pi.binder.annotation);
			const binding: EB.Binding = { type: "Lambda", variable: pi.binder.variable, icit: pi.binder.icit, annotation: ann };
			const xtended = EB.bind(ctx, binding, pi.binder.annotation);
			const applied = yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(lvl));
			const body = yield* M.reader.local(_ => xtended, wrapLambda(term, applied));
			return EB.Constructors.Abs(binding, body);
		})
		.otherwise(function* () {
			return term;
		});
};

// TODO: We might want to remove this pass altogether in the future. Perhaps merge it with a lowering pass.
/**
 * Instantiates unconstrained meta variables in a Term to default values based on their annotations.
 * Constrained metas (those that have been unified to some value) are quoted from their registry solution.
 * Resolved metas (those from implicit resolution) are replaced by their resolved terms.
 * NOTE: this is more zonking than instantiation, but the name is kept for legacy reasons.
 */
export const instantiate = function* (term: EB.Term, resolutions: EB.Resolutions): Zonking<EB.Term> {
	const ctx = yield* M.reader.ask();
	const registry = yield* Metas.registry.get();

	const instantiateRow = function* (row: EB.Row): Zonking<EB.Row> {
		if (row.type === "empty" || row.type === "variable") {
			return row;
		}
		return R.Constructors.Extension(row.label, yield* instantiate(row.value, resolutions), yield* instantiateRow(row.row));
	};

	return yield* match(term)
		.with({ type: "Var", variable: { type: "Meta" } }, function* (v) {
			if (resolutions[v.variable.val]) {
				return yield* NF.quote(ctx.env.length, resolutions[v.variable.val]);
			}

			const solved = Metas.solution(registry, v.variable.val);
			if (solved) {
				const quoted = yield* NF.quote(ctx.env.length, solved);
				// we still need to instantiate in case the quoted term has metas itself
				return yield* instantiate(quoted, resolutions);
			}

			// Don't instantiate metas from outer scopes - they should remain unsolved
			// and will be handled at their original scope level
			if (v.variable.lvl < ctx.env.length) {
				return v;
			}
			const { annotation } = registry[v.variable.val];

			return match(annotation)
				.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => EB.Constructors.Row({ type: "empty" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Any" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Any" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Void" }))
				.otherwise(() => EB.Constructors.Var(v.variable));
		})
		.with({ type: "Abs", binding: { type: "Sigma" } }, function* (sig) {
			const annotation = yield* instantiate(sig.binding.annotation, resolutions);
			const nf = yield* NF.normalize(annotation);
			assert(nf.type === "Row", "Sigma binder annotation must be a Row");
			const xtended = EB.extendSigma(ctx, nf.row);
			const body = yield* M.reader.local(_ => xtended, instantiate(sig.body, resolutions));
			return EB.Constructors.Abs({ ...sig.binding, annotation }, body);
		})
		.with({ type: "Abs" }, function* (abs) {
			const annotation = yield* instantiate(abs.binding.annotation, resolutions);
			const extended = EB.bind(ctx, abs.binding, yield* NF.normalize(annotation));
			const body = yield* M.reader.local(_ => extended, instantiate(abs.body, resolutions));
			return EB.Constructors.Abs({ ...abs.binding, annotation }, body);
		})
		.with({ type: "App" }, function* (app) {
			return EB.Constructors.App(app.icit, yield* instantiate(app.func, resolutions), yield* instantiate(app.arg, resolutions));
		})
		.with({ type: "Row" }, function* ({ row }) {
			return EB.Constructors.Row(yield* instantiateRow(row));
		})
		.with({ type: "Proj" }, function* ({ label, term }) {
			return EB.Constructors.Proj(label, yield* instantiate(term, resolutions));
		})
		.with({ type: "Inj" }, function* ({ label, value, term }) {
			return EB.Constructors.Inj(label, yield* instantiate(value, resolutions), yield* instantiate(term, resolutions));
		})
		.with({ type: "Ann" }, function* ({ term, ann }) {
			return EB.Constructors.Ann(yield* instantiate(term, resolutions), yield* instantiate(ann, resolutions));
		})
		.with({ type: "Match" }, function* ({ scrutinee, alternatives }) {
			const scrut = yield* instantiate(scrutinee, resolutions);
			const alts = yield* Eff.traverse(alternatives, function* (alt) {
				const xtended = alt.binders.reduce((acc, [bv, bty]) => EB.bind(acc, { type: "Let", variable: bv }, bty), ctx);
				const tm = yield* M.reader.local(_ => xtended, instantiate(alt.term, resolutions));
				return { pattern: alt.pattern, term: tm, binders: alt.binders };
			});
			return EB.Constructors.Match(scrut, alts);
		})
		.with({ type: "Block" }, function* ({ return: ret, statements }) {
			type Acc = { stmts: EB.Statement[]; ctx: EB.Context };
			const go = function* (acc: Acc, rest: readonly EB.Statement[]): Zonking<Acc> {
				if (rest.length === 0) {
					return acc;
				}
				const [s, ...tail] = rest;
				if (s.type === "Let") {
					const extended = EB.bind(acc.ctx, { type: "Let", variable: s.variable }, s.annotation);
					const value = yield* M.reader.local(_ => extended, instantiate(s.value, resolutions));
					return yield* go({ stmts: [...acc.stmts, { ...s, value }], ctx: extended }, tail);
				}
				const value = yield* M.reader.local(_ => acc.ctx, instantiate(s.value, resolutions));
				return yield* go({ stmts: [...acc.stmts, { ...s, value }], ctx: acc.ctx }, tail);
			};
			const { stmts, ctx: xtended } = yield* go({ stmts: [], ctx }, statements);

			const r = yield* M.reader.local(_ => xtended, instantiate(ret, resolutions));
			return EB.Constructors.Block(stmts, r);
		})
		.with({ type: "Modal" }, function* ({ term, modalities }) {
			return EB.Constructors.Modal(yield* instantiate(term, resolutions), modalities);
		})
		.otherwise(function* (t) {
			return t;
		});
};
