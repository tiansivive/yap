import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import { Value, Constructors, Patterns, type Source } from "./term";
import assert from "node:assert";
import { match } from "ts-pattern";

import { mapContext, mapSourceValues } from "../computation-traversal";

import { update } from "@yap/utils";

export const traverse = (
	nf: Value,
	onVar: (v: Extract<Value, { type: "Var" }>) => Value,
	onTerm: (tm: EB.Term) => EB.Term,
	seen: ReadonlySet<Value> = new Set(),
): Value => {
	if (seen.has(nf)) {
		return nf;
	}
	const within = new Set([...seen, nf]);
	const value = (v: Value) => traverse(v, onVar, onTerm, within);
	const source = (s: Source) => mapSourceValues(s, value, onTerm);
	return match(nf)
		.with(Patterns.Deferred, ({ source: s }) => Constructors.Deferred(source(s)))
		.with(Patterns.Computation, ({ request, contexts, ctx }) =>
			Constructors.Computation(
				value(request),
				contexts.map(c => mapContext(c, value, source)),
				ctx,
			),
		)
		.with(Patterns.Suspend, ({ identity, payload, annotation, signature }) =>
			Constructors.Suspend(value(identity), value(payload), value(annotation), signature ? value(signature) : undefined),
		)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with(Patterns.Nu, ({ binder, closure }) => {
			const syntax = EB.Constructors.Nu({ ...binder, annotation: binder.source?.annotation ?? EB.Type }, closure.term);
			const mapped = mapSourceValues({ ctx: closure.ctx, term: syntax }, value, onTerm);
			assert(mapped.term.type === "Abs" && mapped.term.binding.type === "Nu", "Nu traversal retains its source binder");
			return Constructors.Nu(
				{ ...binder, annotation: value(binder.annotation), scoped: mapped.term.binding.scoped, source: binder.source ? mapped.term.binding : undefined },
				{ ...closure, ctx: mapped.ctx, term: mapped.term.body },
			);
		})
		.with(Patterns.Lambda, Patterns.Pi, Patterns.Mu, Patterns.Sigma, Patterns.SigmaV2, ({ binder, closure }) => {
			const mapped = mapSourceValues(closure, value, onTerm, binder.type === "Sigma" ? 0 : 1);
			return { ...nf, binder: { ...binder, annotation: value(binder.annotation) }, closure: { ...closure, ctx: mapped.ctx, term: mapped.term } };
		})
		.with(Patterns.External, ({ args, ...external }) => ({ ...external, args: args.map(value) }))
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(value(func), value(arg), icit))
		.with(Patterns.Proj, ({ base, label }) => Constructors.Proj(value(base), label))
		.with(Patterns.Match, ({ closure, scrutinee }) => Constructors.Match(update(closure, "term", onTerm), value(scrutinee)))
		.with(Patterns.Inj, ({ base, label, injected }) => Constructors.Inj(value(base), label, value(injected)))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(
					row,
					v => value(v),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ kind, value: inner }) => Constructors.Neutral(kind, value(inner)))
		.with(Patterns.Glued, ({ folded, unfolded }) => Constructors.Glued(value(folded), value(unfolded)))
		.with(Patterns.Modal, ({ value: inner, modalities }) =>
			Constructors.Modal(value(inner), {
				quantity: modalities.quantity,
				liquid: value(modalities.liquid),
			}),
		)
		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
};
