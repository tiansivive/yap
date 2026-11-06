// Formula normalization for the v2 solver pipeline.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import { Build } from "../../ivl/build";
import type { IVL } from "../../ivl/types";

const Patterns = {
	Term: {
		Arith: { tag: "Arith" } as const,
		Num: { tag: "Num" } as const,
	},
} as const;

export const normalize = (formula: IVL.Formula): IVL.Formula =>
	match(formula)
		.with({ tag: "True" }, f => f)
		.with({ tag: "False" }, f => f)
		.with({ tag: "Not" }, ({ value, origin }) => Build.not(normalize(value), origin))
		.with({ tag: "And" }, ({ values, origin }) => Build.andWithOrigin(values.map(normalize), origin))
		.with({ tag: "Or" }, ({ values, origin }) => Build.orWithOrigin(values.map(normalize), origin))
		.with({ tag: "Implies" }, ({ left, right, origin }) => Build.implies(normalize(left), normalize(right), origin))
		.with({ tag: "Forall" }, ({ binders, body, triggers, origin }) => Build.forall(binders, normalize(body), origin, triggers))
		.with({ tag: "Exists" }, ({ binders, body, origin }) => Build.exists(binders, normalize(body), origin))
		.with({ tag: "Atom" }, ({ op, args, origin }) => atom(op, [normalizeTerm(args[0]), normalizeTerm(args[1])], origin))
		.exhaustive();

/*
 * An atom over the truth of a formula is split on that formula, so that `v = (a > 0)` becomes
 * `(a > 0 ∧ v = true) ∨ (¬(a > 0) ∧ v = false)`. The split introduces no symbol, so it is sound under binders.
 */
const atom = (op: IVL.AtomOp, args: [IVL.Term, IVL.Term], origin?: string): IVL.Formula =>
	match(Hole.list(args))
		.with(undefined, () => Bool.atom(op, args, origin))
		.otherwise(({ formula, fill }) => {
			const condition = normalize(formula);
			const at = (value: boolean): IVL.Formula => {
				const [left, right] = fill(Build.bool(value));
				return atom(op, [left, right], origin);
			};
			return Build.orWithOrigin([Build.and(condition, at(true)), Build.and(Build.not(condition), at(false))], origin);
		});

/* The first `Prop` subterm, with a way to rebuild the surrounding terms around a replacement. */
type Hole<T> = { readonly formula: IVL.Formula; readonly fill: (value: IVL.Term) => T };

const Hole = {
	term: (term: IVL.Term): Hole<IVL.Term> | undefined =>
		match(term)
			.with({ tag: "Prop" }, ({ value }) => ({ formula: value, fill: (t: IVL.Term) => t }))
			.with({ tag: "App" }, ({ head, args, sort }) => Hole.map(Hole.list(args), filled => Build.app(head, filled, sort)))
			.with({ tag: "Arith" }, ({ op, args, sort }) => Hole.map(Hole.list(args), ([l, r]) => Build.arith(op, l, r, sort)))
			.with({ tag: "Select" }, ({ array, index, sort }) => Hole.map(Hole.list([array, index]), ([a, i]) => Build.select(a, i, sort)))
			.otherwise(() => undefined),

	list: (terms: IVL.Term[]): Hole<IVL.Term[]> | undefined =>
		terms.reduce<Hole<IVL.Term[]> | undefined>(
			(found, term, i) =>
				found ??
				Hole.map(Hole.term(term), filled => terms.map((t, j) => (j === i ? filled : t))),
			undefined,
		),

	map: <A, B>(hole: Hole<A> | undefined, f: (a: A) => B): Hole<B> | undefined =>
		match(hole)
			.with(undefined, () => undefined)
			.otherwise(({ formula, fill }) => ({ formula, fill: (value: IVL.Term) => f(fill(value)) })),
};

/*
 * A boolean has two values, so `t = false` is the negation of `t = true`. Stating it that way lets the solver see that
 * `t = true` and `t = false` contradict each other, which congruence closure alone does not know.
 */
const Bool = {
	atom: (op: IVL.AtomOp, args: [IVL.Term, IVL.Term], origin?: string): IVL.Formula =>
		match([op, ...args] as const)
			.with([P.union("=", "!="), { tag: "Bool" }, { tag: "Bool" }], ([op, l, r]) =>
				Bool.truth((l.value === r.value) === (op === "="), origin),
			)
			.with([P.union("=", "!="), { tag: "Bool" }, P._], ([op, l, r]) => Bool.literal(op, r, l.value, origin))
			.with([P.union("=", "!="), P._, { tag: "Bool" }], ([op, l, r]) => Bool.literal(op, l, r.value, origin))
			.otherwise(() => Build.atom(op, args[0], args[1], origin)),

	literal: (op: "=" | "!=", term: IVL.Term, value: boolean, origin?: string): IVL.Formula =>
		match(value === (op === "="))
			.with(true, () => Build.atom("=", term, Build.bool(true), origin))
			.with(false, () => Build.not(Build.atom("=", term, Build.bool(true)), origin))
			.exhaustive(),

	truth: (value: boolean, origin?: string): IVL.Formula =>
		match(value)
			.with(true, () => Build.true_(origin))
			.with(false, () => Build.false_(origin))
			.exhaustive(),
};

const normalizeTerm = (term: IVL.Term): IVL.Term =>
	match(term)
		.with(Patterns.Term.Arith, ({ op, args, sort }) => {
			const left = normalizeTerm(args[0]);
			const right = normalizeTerm(args[1]);
			return match([left, right])
				.with([Patterns.Term.Num, Patterns.Term.Num], ([l, r]) => fold(op, l.value, r.value, sort))
				.otherwise(() => Build.arith(op, left, right, sort));
		})
		.otherwise(t => t);

const fold = (op: IVL.ArithOp, a: string, b: string, sort: IVL.NumSort): IVL.Term => {
	const left = Number(a);
	const right = Number(b);
	return match([Number.isNaN(left), Number.isNaN(right)])
		.with([false, false], () => result(op, left, right, a, b, sort))
		.otherwise(() => Build.arith(op, Build.num(a, sort), Build.num(b, sort), sort));
};

const result = (op: IVL.ArithOp, left: number, right: number, a: string, b: string, sort: IVL.NumSort): IVL.Term => {
	const value = match(op)
		.with("+", () => left + right)
		.with("-", () => left - right)
		.with("*", () => left * right)
		.with("/", () => (right !== 0 ? left / right : NaN))
		.exhaustive();

	return match(Number.isNaN(value))
		.with(false, () => Build.num(value, sort))
		.with(true, () => Build.arith(op, Build.num(a, sort), Build.num(b, sort), sort))
		.exhaustive();
};
