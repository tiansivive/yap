import { match } from "ts-pattern";
import { update } from "@yap/utils";

import * as F from "fp-ts/lib/function";

import * as R from "@yap/shared/rows";
import { Constructors, CtorPatterns, Term } from "./term";

export const traverse = (tm: Term, onVar: (v: Extract<Term, { type: "Var" }>) => Term): Term => {
	return match(tm)
		.with({ type: "Var" }, onVar)
		.with({ type: "Lit" }, lit => lit)
		.with(CtorPatterns.Lambda, ({ binding, body }) => Constructors.Abs(binding, traverse(body, onVar)))
		.with(CtorPatterns.Pi, ({ binding, body }) =>
			Constructors.Abs(
				update(binding, "annotation", tm => tm), // QUESTION: traverse type?
				traverse(body, onVar),
			),
		)
		.with(CtorPatterns.Mu, ({ binding, body }) =>
			Constructors.Abs(
				update(binding, "annotation", tm => tm), // QUESTION: traverse type?
				traverse(body, onVar),
			),
		)
		.with({ type: "App" }, ({ icit, func, arg }) => Constructors.App(icit, traverse(func, onVar), traverse(arg, onVar)))
		.with({ type: "Row" }, ({ row }) =>
			Constructors.Row(
				R.traverse(
					row,
					v => traverse(v, onVar),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Proj" }, ({ label, term }) => Constructors.Proj(label, traverse(term, onVar)))
		.with({ type: "Inj" }, ({ label, value, term }) => Constructors.Inj(label, traverse(value, onVar), traverse(term, onVar)))
		.with({ type: "Ann" }, ({ term, ann }) => Constructors.Ann(traverse(term, onVar), traverse(ann, onVar)))
		.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
			Constructors.Match(
				traverse(scrutinee, onVar),
				alternatives.map(({ pattern, term, binders }) => ({ pattern, term: traverse(term, onVar), binders })),
			),
		)
		.with({ type: "Block" }, ({ return: ret, statements }) => {
			const stmts = statements.map(s =>
				match(s)
					.with({ type: "Let" }, letdec =>
						F.pipe(
							letdec,
							update("value", v => traverse(v, onVar)),
							update("annotation", ann => ann), // QUESTION: traverse type?
						),
					)
					.otherwise(update("value", v => traverse(v, onVar))),
			);
			return Constructors.Block(stmts, traverse(ret, onVar));
		})
		.with({ type: "Modal" }, ({ term, modalities }) => Constructors.Modal(traverse(term, onVar), modalities))
		.with({ type: "Reset" }, ({ term, identity, handler }) => Constructors.Reset(traverse(term, onVar), identity && traverse(identity, onVar), handler && traverse(handler, onVar)))
		.with({ type: "Shift" }, ({ body }) => Constructors.Shift(traverse(body, onVar)))
		.with({ type: "Capture" }, ({ identity, payload }) => Constructors.Capture(traverse(identity, onVar), traverse(payload, onVar)))
		.with({ type: "Resume" }, ({ continuation, value }) => Constructors.Resume(traverse(continuation, onVar), traverse(value, onVar)))
		.with({ type: "Bubble" }, t => ({ ...t, shift: traverse(t.shift, onVar) }))
		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
};

/** Carries binder depth while rewriting syntax, including annotations and recursive lets. */
export const rewrite = (term: Term, at: (term: Term, depth: number) => Term, depth = 0): Term => {
	const go = (term: Term, offset = 0) => rewrite(term, at, depth + offset);
	const mapped = match(term)
		.with({ type: "Abs" }, t => {
			const increment = t.binding.type === "Nu" || t.binding.type === "Sigma" ? 0 : 1;
			return { ...t, binding: { ...t.binding, annotation: go(t.binding.annotation) }, body: go(t.body, increment) };
		})
		.with({ type: "App" }, t => ({ ...t, func: go(t.func), arg: go(t.arg) }))
		.with({ type: "Row" }, t => ({ ...t, row: R.traverse(t.row, value => go(value), v => R.Constructors.Variable(v)) }))
		.with({ type: "Proj" }, { type: "Modal" }, t => ({ ...t, term: go(t.term) }))
		.with({ type: "Inj" }, t => ({ ...t, value: go(t.value), term: go(t.term) }))
		.with({ type: "Ann" }, t => ({ ...t, term: go(t.term), ann: go(t.ann) }))
		.with({ type: "Reset" }, t => ({ ...t, term: go(t.term), identity: t.identity && go(t.identity), handler: t.handler && go(t.handler) }))
		.with({ type: "Capture" }, t => ({ ...t, identity: go(t.identity), payload: go(t.payload) }))
		.with({ type: "Resume" }, t => ({ ...t, continuation: go(t.continuation), value: go(t.value) }))
		.with({ type: "Shift" }, t => ({ ...t, body: go(t.body) }))
		.with({ type: "Bubble" }, t => ({ ...t, shift: go(t.shift) }))
		.with({ type: "Match" }, t => ({ ...t, scrutinee: go(t.scrutinee), alternatives: t.alternatives.map(a => ({ ...a, term: go(a.term, a.binders.length) })) }))
		.with({ type: "Block" }, t => {
			const mapped = t.statements.reduce((acc, statement) => {
				const offset = acc.offset + (statement.type === "Let" ? 1 : 0);
				return { offset, statements: [...acc.statements, { ...statement, value: go(statement.value, offset) }] };
			}, { offset: 0, statements: [] as typeof t.statements });
			return { ...t, statements: mapped.statements, return: go(t.return, mapped.offset) };
		})
		.otherwise(t => t);
	return at(mapped, depth);
};
