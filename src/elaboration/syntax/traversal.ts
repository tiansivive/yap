import { match } from "ts-pattern";
import { update } from "@yap/utils";

import * as F from "fp-ts/lib/function";

import * as R from "@yap/shared/rows";
import { Constructors, CtorPatterns, Term } from "./term";

export const traverse = (tm: Term, onVar: (v: Extract<Term, { type: "Var" }>) => Term): Term => {
	return (
		match(tm)
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
			//.with({ type: "Annotation" }, ({ term, ann }) => Constructors.Annotation(traverse(term, onVar), traverse(ann, onVar)))
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
			.otherwise(() => {
				throw new Error("Traverse: Not implemented yet");
			})
	);
};
