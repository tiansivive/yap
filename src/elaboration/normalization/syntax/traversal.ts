import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import { Value, Constructors, Patterns } from "./term";
import { match } from "ts-pattern";

import { update } from "@yap/utils";

export const traverse = (nf: Value, onVar: (v: Extract<Value, { type: "Var" }>) => Value, onTerm: (tm: EB.Term) => EB.Term): Value => {
	return match(nf)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with(Patterns.Lambda, ({ binder, closure }) =>
			Constructors.Lambda(binder.variable, binder.icit, update(closure, "term", onTerm), traverse(binder.annotation, onVar, onTerm)),
		)
		.with(Patterns.Pi, ({ binder, closure }) => {
			const { annotation } = binder;
			return Constructors.Pi(binder.variable, binder.icit, traverse(annotation, onVar, onTerm), update(closure, "term", onTerm));
		})
		.with(Patterns.Psi, ({ binder, closure }) =>
			Constructors.Psi(binder.variable, binder.requirement && traverse(binder.requirement, onVar, onTerm), update(closure, "term", onTerm)),
		)
		.with(Patterns.Phi, ({ binder, closure }) => Constructors.Phi(binder.variable, traverse(binder.annotation, onVar, onTerm), update(closure, "term", onTerm)))
		.with(Patterns.Mu, ({ binder, closure }) => {
			const { annotation } = binder;
			return Constructors.Mu(binder.variable, binder.source, traverse(annotation, onVar, onTerm), update(closure, "term", onTerm));
		})
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(traverse(func, onVar, onTerm), traverse(arg, onVar, onTerm), icit))
		.with(Patterns.Proj, ({ base, label }) => Constructors.Proj(traverse(base, onVar, onTerm), label))
		.with(Patterns.Match, ({ closure, scrutinee }) => Constructors.Match(update(closure, "term", onTerm), traverse(scrutinee, onVar, onTerm)))
		.with(Patterns.Inj, ({ base, label, injected }) => Constructors.Inj(traverse(base, onVar, onTerm), label, traverse(injected, onVar, onTerm)))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(
					row,
					v => traverse(v, onVar, onTerm),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ kind, value }) => Constructors.Neutral(kind, traverse(value, onVar, onTerm)))
		.with(Patterns.Bubble, ({ meta, ann, values, identity, payload }) =>
			Constructors.Bubble(
				meta,
				traverse(ann, onVar, onTerm),
				values.map(value => traverse(value, onVar, onTerm)),
				traverse(identity, onVar, onTerm),
				traverse(payload, onVar, onTerm),
			),
		)
		.with(Patterns.Reset, ({ value, handling }) =>
			Constructors.Reset(traverse(value, onVar, onTerm), {
				identity: traverse(handling.identity, onVar, onTerm),
				handler: traverse(handling.handler, onVar, onTerm),
			}),
		)
		.with(Patterns.Existential, ({ variable, annotation, assumptions, body }) =>
			Constructors.Exists(
				variable,
				traverse(annotation, onVar, onTerm),
				{ ctx: body.ctx, value: traverse(body.value, onVar, onTerm) },
				new Map([...assumptions].map(([key, value]) => [key, traverse(value, onVar, onTerm)])),
			),
		)
		.with(Patterns.Glued, ({ folded, unfolded }) => Constructors.Glued(traverse(folded, onVar, onTerm), traverse(unfolded, onVar, onTerm)))
		.with(Patterns.Modal, ({ value, modalities }) =>
			Constructors.Modal(traverse(value, onVar, onTerm), {
				quantity: modalities.quantity,
				liquid: modalities.liquid && traverse(modalities.liquid, onVar, onTerm),
			}),
		)
		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
};
