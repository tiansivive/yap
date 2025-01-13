import { match, P } from "ts-pattern";
import {
	Abs,
	App,
	Free,
	Lambda,
	Let,
	Lit,
	Pi,
	Refinement,
	Term,
	Type,
	Var,
} from "../../terms.js";
import { Context } from "./context.js";

import * as X from "../../utils.js";
import * as Redux from "../reduction.js";

import { Constraint, Forall } from "./horn-constraints.js";

import * as T from "./translation.js";
import * as HC from "./horn-constraints.js";

export const sub = (v: string, r: Refinement) =>
	match(r)
		.with({ tag: "Predicate" }, (rr) => ({ ...rr, variable: v }))
		.otherwise(() => r);

export const rv = (r: Refinement) =>
	match(r)
		.with({ tag: "Hole" }, () => {
			throw X.error("Cannot get variable from hole", r);
		})
		.with({ tag: "Predicate" }, ({ variable }) => variable)
		.with({ tag: "Template" }, ({ hornVar }) => hornVar)
		.run();

export const symbolic = (ctx: Context, v: string) => {
	const count = ctx.local.filter(({ variable }) => variable === v).length;
	return `${v}${count}`;
};

export const sortOf = (ctx: Context, t: Term) => {
	return match(t)
		.with({ tag: "Lit", value: { tag: "Unit" } }, () => "unit")
		.with({ tag: "Lit" }, () => {
			throw X.error("Cannot get sort of non-unit literal", t);
		})
		.with({ tag: "Var", variable: { tag: "Free", name: P.select() } }, (x) => {
			switch (x) {
				case "Int":
				case "String":
				case "Bool":
					return x;
				default:
					return symbolic(ctx, x);
			}
		})
		.with(
			{ tag: "Var", variable: { tag: "Bound", deBruijn: P.select() } },
			(i) => {
				if (i >= ctx.local.length) {
					throw `Variable not found in context: ${i}`;
				}
				return symbolic(ctx, ctx.local[i].variable);
			},
		)

		.with({ tag: "Abs", binder: { tag: "Pi" } }, ({ binder }) => {
			throw "TODO: make sorts support Functions";
		})
		.otherwise((t) => {
			throw X.error("TODO: support more sorts", t);
		});
};

export const imply = (
	ctx: Context,
	v: string,
	t: Term,
	c: Constraint,
): Constraint =>
	match(t)
		.with({ tag: "Refined" }, (r) =>
			Forall(
				symbolic(ctx, v),
				sortOf(ctx, r.term),
				T.translate(ctx, r.term, sub(v, r.ref)),
				c,
			),
		)
		.otherwise(() => c);

export const tru = HC.Predicate(HC.Boolean(true));

// Pattern constructors
export const Arrow: (s: Term, t: Term) => Term = (s, t) =>
	Abs(Pi("_", s), Redux.shift(1, t));
export const ArrowPattern: (
	s: P.Pattern<Term>,
	t: P.Pattern<Term>,
) => P.Pattern<Term> = (s, t) => Abs<"Pattern">(Pi<"Pattern">("_", s), t);

export const Lam: (x: string, s: Term, t: Term) => Term = (x, s, t) =>
	Abs(Lambda(x, s), t);
export const LamPattern: (
	x: P.Pattern<string>,
	s: P.Pattern<Term>,
	t: P.Pattern<Term>,
) => P.Pattern<Term> = (x, s, t) => Abs<"Pattern">(Lambda<"Pattern">(x, s), t);

export const TT: (x: string, s: Term, t: Term) => Term = (x, s, t) =>
	Abs(Pi(x, s), Redux.shift(1, t));
export const TTPattern: (
	x: P.Pattern<string>,
	s: P.Pattern<Term>,
	t: P.Pattern<Term>,
) => P.Pattern<Term> = (x, s, t) => Abs<"Pattern">(Pi<"Pattern">(x, s), t);

export const TLet: (x: string, v: Term, t: Term, e: Term) => Term = (
	x,
	v,
	t,
	e,
) => Abs(Let(x, v, t), e);
export const TLetPattern: (
	x: P.Pattern<string>,
	v: P.Pattern<Term>,
	t: P.Pattern<Term>,
	e: P.Pattern<Term>,
) => P.Pattern<Term> = (x, v, t, e) =>
	Abs<"Pattern">(Let<"Pattern">(x, v, t), e);

export const RefEQ: (e1: Term, e2: Term) => Term = (e1, e2) =>
	App(App(Var(Free("=")), e1), e2);
export const RefEQPattern: (
	e1: P.Pattern<Term>,
	e2: P.Pattern<Term>,
) => P.Pattern<Term> = (e1, e2) =>
	App<"Pattern">(App<"Pattern">(Var<"Pattern">(Free("=")), e1), e2);

/**
 * Universal quantification alias
 */
export const QAll: (a: string, t: Term) => Term = (a, t) =>
	TT(a, Lit(Type()), Redux.shift(1, t));
export const QAllPattern: (
	a: P.Pattern<string>,
	t: P.Pattern<Term>,
) => P.Pattern<Term> = (a, t) => TTPattern(a, Lit<"Pattern">(Type()), t);

/**
 * Church encoding alias for existential quantification
 */
export const QExists: (x: string, s: Term, t: Term) => Term = (x, s, t) =>
	QAll(
		"__exists__",
		Arrow(TT(x, s, Arrow(t, Var(Free("__exists__")))), Var(Free("__exists__"))),
	);
export const QExistsPattern: (
	x: P.Pattern<string>,
	s: P.Pattern<Term>,
	t: P.Pattern<Term>,
) => P.Pattern<Term> = (x, s, t) =>
	QAllPattern(
		"__exists__",
		ArrowPattern(
			TTPattern(x, s, ArrowPattern(t, Var<"Pattern">(Free("__exists__")))),
			Var<"Pattern">(Free("__exists__")),
		),
	);
