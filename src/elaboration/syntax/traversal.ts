import assert from "assert";
import { isMatching, match } from "ts-pattern";

import * as NF from "../normalization";
import * as R from "@yap/shared/rows";
import { Constructors, CtorPatterns, Term } from "./term";

/** Supplying `onValue` also visits Core annotations and their embedded semantic values. */
export const traverse = (tm: Term, onVar: (v: Extract<Term, { type: "Var" }>) => Term, onValue?: (value: NF.Value) => NF.Value): Term => {
	const go = (term: Term): Term => traverse(term, onVar, onValue);
	const value = (value: NF.Value) => onValue?.(value) ?? value;
	return match(tm)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with({ type: "Abs" }, ({ binding, body }) =>
			Constructors.Abs(
				match(binding)
					.with({ type: "Nu" }, binding => ({
						...binding,
						annotation: onValue ? go(binding.annotation) : binding.annotation,
						scoped: R.traverse(binding.scoped, go, variable => R.Constructors.Variable(variable)),
					}))
					.otherwise(binding => ({ ...binding, annotation: onValue ? go(binding.annotation) : binding.annotation })),
				go(body),
			),
		)
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(icit, go(func), go(arg)))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(row, go, variable => {
					const transformed = onValue ? go(Constructors.Var(variable)) : Constructors.Var(variable);
					assert(isMatching(CtorPatterns.Var, transformed), "A row tail must remain a variable during traversal");
					return R.Constructors.Variable(transformed.variable);
				}),
			),
		)
		.with({ type: "Proj" }, ({ label, term }) => Constructors.Proj(label, go(term)))
		.with({ type: "Inj" }, ({ label, value, term }) => Constructors.Inj(label, go(value), go(term)))
		.with({ type: "Ann" }, ({ term, ann }) => Constructors.Ann(go(term), go(ann)))
		.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
			Constructors.Match(
				go(scrutinee),
				alternatives.map(({ pattern, term, binders }) => ({
					pattern,
					term: go(term),
					binders: binders.map(([name, annotation]) => [name, value(annotation)]),
				})),
			),
		)
		.with({ type: "Block" }, ({ return: ret, statements }) =>
			Constructors.Block(
				statements.map(statement =>
					match(statement)
						.with({ type: "Expression" }, statement => ({ ...statement, value: go(statement.value) }))
						.otherwise(statement => ({ ...statement, value: go(statement.value), annotation: value(statement.annotation) })),
				),
				go(ret),
			),
		)
		.with({ type: "Reset" }, ({ term, handling }) =>
			Constructors.Reset(go(term), handling && { identity: go(handling.identity), handler: go(handling.handler) }),
		)
		.with({ type: "Shift" }, ({ body }) => Constructors.Shift(go(body)))
		.with(CtorPatterns.Bubble, ({ meta, ann, values, identity, payload }) => Constructors.Bubble(meta, go(ann), values.map(value), go(identity), go(payload)))
		.with(CtorPatterns.ShiftBubble, ({ meta, ann, values, shift }) => Constructors.ShiftBubble(meta, value(ann), values.map(value), go(shift)))
		.with({ type: "Modal" }, ({ term, modalities }) => Constructors.Modal(go(term), onValue ? { ...modalities, liquid: go(modalities.liquid) } : modalities))
		.exhaustive();
};
