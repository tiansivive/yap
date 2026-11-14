import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import { Value, Constructors, Patterns } from "./term";
import assert from "assert";
import { isMatching, match } from "ts-pattern";

export const traverse = (
	nf: Value,
	onVar: (v: Extract<Value, { type: "Var" }>) => Value,
	onTerm: (tm: EB.Term) => EB.Term,
	scope?: { context: (ctx: EB.Context) => EB.Context; level: (level: number) => number },
): Value => {
	const go = (value: Value): Value => traverse(value, onVar, onTerm, scope);
	const closure = (value: EB.NF.Closure): EB.NF.Closure => ({ ...value, ctx: scope?.context(value.ctx) ?? value.ctx, term: onTerm(value.term) });
	return match(nf)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with({ type: "Abs" }, ({ binder, closure: body }) =>
			Constructors.Abs(
				match(binder)
					.with({ type: "Nu" }, binder => {
						const scoped = onTerm(EB.Constructors.Row(binder.scoped));
						assert(isMatching(EB.CtorPatterns.Row, scoped), "A Nu scope must remain a row during traversal");
						return { ...binder, annotation: go(binder.annotation), scoped: scoped.row };
					})
					.otherwise(binder => ({ ...binder, annotation: go(binder.annotation) })),
				closure(body),
			),
		)
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(go(func), go(arg), icit))
		.with(Patterns.Reset, ({ value, handling }) => Constructors.Reset(go(value), { identity: go(handling.identity), handler: go(handling.handler) }))
		.with(Patterns.Existential, ({ variable, annotation, body, producer }) =>
			Constructors.Exists(
				variable,
				go(annotation),
				{ ctx: scope?.context(body.ctx) ?? body.ctx, level: scope?.level(body.level) ?? body.level, value: go(body.value) },
				producer && go(producer),
			),
		)
		.with(Patterns.Proj, ({ base, label }) => Constructors.Proj(go(base), label))
		.with(Patterns.Match, ({ closure: body, scrutinee }) => Constructors.Match(closure(body), go(scrutinee)))
		.with(Patterns.Inj, ({ base, label, injected }) => Constructors.Inj(go(base), label, go(injected)))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(row, go, variable => {
					const value = scope ? go(Constructors.Var(variable)) : Constructors.Var(variable);
					assert(isMatching(Patterns.Var, value), "A row tail must remain a variable during traversal");
					return R.Constructors.Variable(value.variable);
				}),
			),
		)
		.with({ type: "Neutral" }, ({ kind, value }) => Constructors.Neutral(kind, go(value)))
		.with(Patterns.Bubble, ({ meta, ann, values, identity, payload }) => Constructors.Bubble(meta, go(ann), values.map(go), go(identity), go(payload)))
		.with(Patterns.Glued, ({ folded, unfolded }) => Constructors.Glued(go(folded), go(unfolded)))
		.with(Patterns.Modal, ({ value, modalities }) => Constructors.Modal(go(value), { quantity: modalities.quantity, liquid: go(modalities.liquid) }))
		.with(Patterns.External, ({ name, arity, compute, args }) => Constructors.External(name, arity, compute, args.map(go)))
		.exhaustive();
};
