import { match, P } from "ts-pattern";

import * as R from "@yap/shared/rows";
import { Constructors, Term, Statement, Pattern, Row, CtorPatterns } from "./term";

export const traverse = (tm: Term, onVar: (v: Extract<Term, { type: "Var" }>, depth: number) => Term, depth = 0): Term => {
	const visit = (term: Term, within = depth): Term => traverse(term, onVar, within);
	const row = (value: Row): Row =>
		R.traverse(
			value,
			value => visit(value),
			(variable): Row =>
				match(visit(Constructors.Var(variable)))
					.with({ type: "Var" }, ({ variable }) => R.Constructors.Variable<Term, typeof variable>(variable))
					.with({ type: "Row" }, ({ row }) => row)
					.otherwise(() => {
						throw new Error("A row tail rewrites to a variable or row");
					}),
		);
	const pattern = (value: Pattern): Pattern =>
		match(value)
			.with({ type: "Var" }, value => ({ ...value, term: visit(value.term) }))
			.with({ type: P.union("Row", "Struct", "Variant") }, value => ({
				...value,
				row: R.traverse(value.row, pattern, variable => R.Constructors.Variable<Pattern, string>(variable)),
			}))
			.with({ type: "List" }, value => ({ ...value, patterns: value.patterns.map(pattern) }))
			.otherwise(value => value);
	const statements = (values: Statement[], within: number): { statements: Statement[]; depth: number } => {
		const [first, ...rest] = values;

		if (!first) {
			return { statements: [], depth: within };
		}
		const next = within + (first.type === "Let" ? 1 : 0);
		const tail = statements(rest, next);
		return { statements: [{ ...first, value: visit(first.value, next) }, ...tail.statements], depth: tail.depth };
	};

	return match(tm)
		.with({ type: "Var" }, value => onVar(value, depth))
		.with({ type: "Lit" }, value => value)
		.with(CtorPatterns.Nu, ({ binding, body }) =>
			Constructors.Abs({ ...binding, annotation: visit(binding.annotation), scoped: row(binding.scoped) }, visit(body)),
		)
		.with(CtorPatterns.Sigma, ({ binding, body }) => Constructors.Abs({ ...binding, annotation: visit(binding.annotation) }, visit(body)))
		.with({ type: "Abs", binding: { type: "Let" } }, ({ binding, body }) =>
			Constructors.Abs({ ...binding, annotation: visit(binding.annotation), value: visit(binding.value, depth + 1) }, visit(body, depth + 1)),
		)
		.with({ type: "Abs" }, ({ binding, body }) => Constructors.Abs({ ...binding, annotation: visit(binding.annotation) }, visit(body, depth + 1)))
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(icit, visit(func), visit(arg)))
		.with({ type: "Row" }, value => Constructors.Row(row(value.row)))
		.with({ type: "Proj" }, ({ label, term }) => Constructors.Proj(label, visit(term)))
		.with({ type: "Inj" }, ({ label, value, term }) => Constructors.Inj(label, visit(value), visit(term)))
		.with({ type: "Ann" }, ({ term, ann }) => Constructors.Ann(visit(term), visit(ann)))
		.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
			Constructors.Match(
				visit(scrutinee),
				alternatives.map(alt => ({ ...alt, pattern: pattern(alt.pattern), term: visit(alt.term, depth + alt.binders.length) })),
			),
		)
		.with({ type: "Block" }, value => {
			const rewritten = statements(value.statements, depth);
			return Constructors.Block(rewritten.statements, visit(value.return, rewritten.depth));
		})
		.with({ type: "Reset" }, ({ term, handling }) =>
			Constructors.Reset(visit(term), handling && { identity: visit(handling.identity), handler: visit(handling.handler) }),
		)
		.with({ type: "Suspend" }, ({ identity, payload, annotation }) => Constructors.Suspend(visit(identity), visit(payload), visit(annotation)))
		.with({ type: "Shift" }, ({ body }) => Constructors.Shift(visit(body)))
		.with({ type: "Bubble" }, value => ({ ...value, shift: visit(value.shift) }))
		.with({ type: "Modal" }, ({ term, modalities }) => Constructors.Modal(visit(term), { ...modalities, liquid: visit(modalities.liquid) }))
		.exhaustive();
};

export const weaken = (term: Term, amount: number): Term =>
	traverse(term, (term, depth) =>
		match(term.variable)
			.with(
				{ type: P.union("Bound", "DepLabel") },
				variable => variable.index >= depth,
				variable => Constructors.Var({ ...variable, index: variable.index + amount }),
			)
			.otherwise(() => term),
	);
