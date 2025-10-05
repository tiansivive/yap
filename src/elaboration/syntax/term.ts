import { Types, update } from "@yap/utils";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as NF from "../normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";
import { Literal } from "@yap/shared/literals";

import { match, Pattern as Pat } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import { Simplify } from "type-fest";

import * as Modal from "@yap/verification/modalities/shared";

export type Term = Types.Brand<typeof tag, Constructor & { id: number }>;
const tag: unique symbol = Symbol("Term");
type Constructor =
	| { type: "Lit"; value: Literal }
	| { type: "Var"; variable: Variable }
	| { type: "Abs"; binding: Binding; body: Term }
	| { type: "App"; icit: Implicitness; func: Term; arg: Term }
	| { type: "Row"; row: Row }
	| { type: "Proj"; label: string; term: Term }
	| { type: "Inj"; label: string; value: Term; term: Term }
	| { type: "Match"; scrutinee: Term; alternatives: Array<Alternative> }
	| { type: "Block"; statements: Array<Statement>; return: Term }
	| { type: "Modal"; term: Term; modalities: Modal.Annotations };

export type Variable =
	| { type: "Bound"; index: number }
	| { type: "Free"; name: string }
	| { type: "Foreign"; name: string }
	| { type: "Label"; name: string }
	/**
	 * @see Unification.bind for the reason why we need to store the level
	 */
	| { type: "Meta"; val: number; lvl: number };
export type Meta = Extract<Variable, { type: "Meta" }>;
export type Row = R.Row<Term, Variable>;

export type Binding =
	| { type: "Let"; variable: string; value: Term; annotation: Term; modalities: Modal.Annotations }
	| { type: "Lambda"; variable: string; icit: Implicitness }
	| { type: "Mu"; variable: string; annotation: Term; source: string }
	// | { type: "Sigma"; variable: string; annotation: Term, multiplicity: Q.Multiplicity; }
	| {
			type: "Pi";
			variable: string;
			annotation: Term;
			modalities: Modal.Annotations;
			icit: Implicitness;
	  };

export type Alternative = { pattern: Pattern; term: Term };
export type Pattern =
	| { type: "Binder"; value: string }
	| { type: "Var"; value: string; term: Term }
	| { type: "Lit"; value: Literal }
	| { type: "Row"; row: R.Row<Pattern, string> }
	| { type: "Struct"; row: R.Row<Pattern, string> }
	| { type: "Variant"; row: R.Row<Pattern, string> }
	| { type: "List"; patterns: Pattern[]; rest?: string }
	| { type: "Wildcard" };

export type Statement =
	| { type: "Expression"; value: Term }
	| { type: "Let"; variable: string; value: Term; annotation: Term; modalities: Modal.Annotations }
	| { type: "Using"; value: Term; annotation: NF.Value };

export const Bound = (index: number): Variable => ({ type: "Bound", index });
export const Free = (name: string): Variable => ({ type: "Free", name });
export const Meta = (val: number, lvl: number): Variable => ({ type: "Meta", val, lvl });

let currentId = 0;
const nextId = () => ++currentId;
export const mk = <K extends Constructor["type"]>(ctor: Extract<Constructor, { type: K }>) => {
	const r = Types.make(tag, { ...ctor, id: nextId() });
	return r as Simplify<typeof r>;
};

export const Constructors = {
	Abs: (binding: Binding, body: Term): Extract<Term, { type: "Abs" }> => mk({ type: "Abs", binding, body }),
	Lambda: (variable: string, icit: Implicitness, body: Term): Term =>
		mk({
			type: "Abs",
			binding: { type: "Lambda" as const, variable, icit },
			body,
		}),
	Pi: (variable: string, icit: Implicitness, modalities: Modal.Annotations, annotation: Term, body: Term): Term =>
		mk({
			type: "Abs",
			binding: { type: "Pi" as const, variable, icit, annotation, modalities },
			body,
		}),
	Mu: (variable: string, source: string, annotation: Term, body: Term): Term =>
		mk({
			type: "Abs",
			binding: { type: "Mu", variable, source, annotation },
			body,
		}),
	Var: (variable: Variable): Term =>
		mk({
			type: "Var",
			variable,
		}),
	Vars: {
		Bound: (index: number): Variable => ({ type: "Bound", index }),
		Free: (name: string): Variable => ({ type: "Free", name }),
		Foreign: (name: string): Variable => ({ type: "Foreign", name }),
		Label: (name: string): Variable => ({ type: "Label", name }),
		Meta: (val: number, lvl: number): Variable => ({ type: "Meta", val, lvl }),
	},
	App: (icit: Implicitness, func: Term, arg: Term): Term =>
		mk({
			type: "App",
			icit,
			func,
			arg,
		}),
	Lit: (value: Literal): Term =>
		mk({
			type: "Lit",
			value,
		}),
	// Annotation: (term: Term, ann: Term): Term => ({ type: "Annotation", term, ann }),

	Row: (row: Row): Term => mk({ type: "Row", row }),
	Extension: (label: string, value: Term, row: Row): Row => ({ type: "extension", label, value, row }),

	Struct: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Struct")), Constructors.Row(row)),
	Schema: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row)),
	Variant: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row)),
	Proj: (label: string, term: Term): Term => mk({ type: "Proj", label, term }),
	Inj: (label: string, value: Term, term: Term): Term => mk({ type: "Inj", label, value, term }),

	Indexed: (index: Term, term: Term, strategy?: Term): Term => {
		const indexing = Constructors.App("Explicit", Constructors.Var({ type: "Foreign", name: "Indexed" }), index);
		const values = Constructors.App("Explicit", indexing, term);
		const strat = Constructors.App("Implicit", values, strategy ? strategy : Constructors.Var({ type: "Foreign", name: "defaultHashMap" }));
		return strat;
	},

	Match: (scrutinee: Term, alternatives: Array<Alternative>): Term => mk({ type: "Match", scrutinee, alternatives }),
	Alternative: (pattern: Pattern, term: Term): Alternative => ({ pattern, term }),

	Block: (statements: Array<Statement>, term: Term): Term => mk({ type: "Block", statements, return: term }),

	Modal: (term: Term, modalities: Modal.Annotations): Term => mk({ type: "Modal", term, modalities }),

	Patterns: {
		Binder: (value: string): Pattern => ({ type: "Binder", value }),
		Var: (value: string, term: Term): Pattern => ({ type: "Var", value, term }),
		Lit: (value: Literal): Pattern => ({ type: "Lit", value }),
		Row: (row: R.Row<Pattern, string>): Pattern => ({ type: "Row", row }),
		Extension: (label: string, value: Pattern, row: R.Row<Pattern, string>): R.Row<Pattern, string> => R.Constructors.Extension(label, value, row),
		Struct: (row: R.Row<Pattern, string>): Pattern => ({ type: "Struct", row }),
		Variant: (row: R.Row<Pattern, string>): Pattern => ({ type: "Variant", row }),
		Wildcard: (): Pattern => ({ type: "Wildcard" }),
		List: (patterns: Pattern[], rest?: string): Pattern => ({ type: "List", patterns, rest }),
	},
	Stmt: {
		Let: (variable: string, value: Term, annotation: Term, modalities: Modal.Annotations): Statement => ({
			type: "Let",
			variable,
			value,
			annotation,
			modalities,
		}),
		Expr: (value: Term): Statement => ({ type: "Expression", value }),
	},
};

export const CtorPatterns = {
	Var: { type: "Var" },
	Lit: { type: "Lit" },
	Lambda: { type: "Abs", binding: { type: "Lambda" } },
	Pi: { type: "Abs", binding: { type: "Pi" } },
	Mu: { type: "Abs", binding: { type: "Mu" } },
	Match: { type: "Match" },
	Row: { type: "Row" },
	Proj: { type: "Proj" },
	Inj: { type: "Inj" },
	Annotation: { type: "Annotation" },
} as const;

export const traverse = (tm: Term, onVar: (v: Extract<Term, { type: "Var" }>) => Term): Term => {
	return (
		match(tm)
			.with({ type: "Var" }, onVar)
			.with({ type: "Lit" }, lit => lit)
			.with(CtorPatterns.Lambda, ({ binding, body }) => Constructors.Abs(binding, traverse(body, onVar)))
			.with(CtorPatterns.Pi, ({ binding, body }) =>
				Constructors.Abs(
					update(binding, "annotation", tm => traverse(tm, onVar)),
					traverse(body, onVar),
				),
			)
			.with(CtorPatterns.Mu, ({ binding, body }) =>
				Constructors.Abs(
					update(binding, "annotation", tm => traverse(tm, onVar)),
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
					alternatives.map(({ pattern, term }) => ({ pattern, term: traverse(term, onVar) })),
				),
			)
			.with({ type: "Block" }, ({ return: ret, statements }) => {
				const stmts = statements.map(s =>
					match(s)
						.with({ type: "Let" }, letdec =>
							F.pipe(
								letdec,
								update("value", v => traverse(v, onVar)),
								update("annotation", ann => traverse(ann, onVar)),
							),
						)
						.otherwise(update("value", v => traverse(v, onVar))),
				);
				return Constructors.Block(stmts, traverse(ret, onVar));
			})
			.otherwise(() => {
				throw new Error("Traverse: Not implemented yet");
			})
	);
};
