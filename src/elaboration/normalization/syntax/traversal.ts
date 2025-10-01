import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import { Value, Constructors, Patterns } from "./term";
import { match } from "ts-pattern";

import { update } from "@yap/utils";

export const traverse = (nf: Value, onVar: (v: Extract<Value, { type: "Var" }>) => Value, onTerm: (tm: EB.Term) => EB.Term): Value => {
	return match(nf)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with(Patterns.Lambda, ({ binder, closure }) => Constructors.Lambda(binder.variable, binder.icit, update(closure, "term", onTerm)))
		.with(Patterns.Pi, ({ binder, closure }) => {
			const { annotation } = binder;
			return Constructors.Pi(binder.variable, binder.icit, [traverse(annotation[0], onVar, onTerm), annotation[1]], update(closure, "term", onTerm));
		})
		.with(Patterns.Mu, ({ binder, closure }) => {
			const { annotation } = binder;
			return Constructors.Mu(binder.variable, binder.source, [traverse(annotation[0], onVar, onTerm), annotation[1]], update(closure, "term", onTerm));
		})
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(traverse(func, onVar, onTerm), traverse(arg, onVar, onTerm), icit))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(
					row,
					v => traverse(v, onVar, onTerm),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ value }) => Constructors.Neutral(traverse(value, onVar, onTerm)))

		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
};
