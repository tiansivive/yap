// Formula normalization for the v2 solver pipeline.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as O from "fp-ts/Option";
import { match, P } from "ts-pattern";
import { Build } from "../../ivl/build";
import { Patterns } from "../../ivl/patterns";
import type { IVL } from "../../ivl/types";

export const normalize = (formula: IVL.Formula): IVL.Formula =>
	match(formula)
		.with(Patterns.Formula.True, Patterns.Formula.False, f => f)
		.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(normalize(value), origin))
		.with(Patterns.Formula.And, ({ values, origin }) => Build.andWithOrigin(values.map(normalize), origin))
		.with(Patterns.Formula.Or, ({ values, origin }) => Build.orWithOrigin(values.map(normalize), origin))
		.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(normalize(left), normalize(right), origin))
		.with(Patterns.Formula.Forall, ({ binders, body, triggers: hints, origin }) => Build.forall(binders, normalize(body), origin, triggers(hints)))
		.with(Patterns.Formula.Exists, ({ binders, body, origin }) => Build.exists(binders, normalize(body), origin))
		.with(Patterns.Formula.Atom, ({ op, args, origin }) => atom(op, [normalizeTerm(args[0]), normalizeTerm(args[1])], origin))
		.exhaustive();

/* Splitting at the containing atom keeps each formula value inside its original binders. */
const atom = (op: IVL.AtomOp, args: [IVL.Term, IVL.Term], origin?: string): IVL.Formula =>
	O.match(
		() => Bool.atom(op, args, origin),
		({ formula, fill }: Hole<IVL.Term[]>) => {
			const condition = normalize(formula);
			const at = (value: boolean): IVL.Formula => {
				const [left, right] = fill(Build.bool(value));
				return atom(op, [left, right], origin);
			};
			return Build.orWithOrigin([Build.and(condition, at(true)), Build.and(Build.not(condition), at(false))], origin);
		},
	)(Hole.list(args));

type Hole<T> = { readonly formula: IVL.Formula; readonly fill: (value: IVL.Term) => T };

const Hole = {
	term: (term: IVL.Term): O.Option<Hole<IVL.Term>> =>
		match(term)
			.with(Patterns.Term.Prop, ({ value }) => O.some({ formula: value, fill: (t: IVL.Term) => t }))
			.with(Patterns.Term.App, ({ head, args, sort }) => Hole.map(Hole.list(args), filled => Build.app(head, filled, sort)))
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Hole.map(Hole.list(args), ([l, r]) => Build.arith(op, l, r, sort)))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Hole.map(Hole.list([array, index]), ([a, i]) => Build.select(a, i, sort)))
			.with(Patterns.Term.Row, ({ row, sort }) => Hole.map(Hole.row(row), filled => Build.row(filled, sort)))
			.with(Patterns.Term.Var, Patterns.Term.Const, Patterns.Term.Num, Patterns.Term.Bool, Patterns.Term.Str, () => O.none)
			.exhaustive(),

	row: (row: IVL.RowTerm): O.Option<Hole<IVL.RowTerm>> =>
		match(row)
			.with(Patterns.Row.Extend, ({ label, value, rest }) =>
				O.alt(() => Hole.map(Hole.row(rest), filled => Build.rowExtend(label, value, filled)))(
					Hole.map(Hole.term(value), filled => Build.rowExtend(label, filled, rest)),
				),
			)
			.with(Patterns.Row.Empty, Patterns.Row.Var, () => O.none)
			.exhaustive(),

	list: (terms: IVL.Term[]): O.Option<Hole<IVL.Term[]>> =>
		terms.reduce<O.Option<Hole<IVL.Term[]>>>(
			(found, term, i) => O.alt(() => Hole.map(Hole.term(term), filled => terms.map((t, j) => (j === i ? filled : t))))(found),
			O.none,
		),

	map: <A, B>(hole: O.Option<Hole<A>>, f: (a: A) => B): O.Option<Hole<B>> =>
		O.map(({ formula, fill }: Hole<A>) => ({ formula, fill: (value: IVL.Term) => f(fill(value)) }))(hole),
};

/* Inference resumes when every supplied trigger group contains a formula value. */
const triggers = (hints: IVL.Trigger[] | undefined): IVL.Trigger[] | undefined =>
	match(hints)
		.with(undefined, () => undefined)
		.with([], () => [])
		.otherwise(hints =>
			match(
				hints.filter(({ terms }) =>
					O.match(
						() => true,
						() => false,
					)(Hole.list(terms)),
				),
			)
				.with([], () => undefined)
				.otherwise(safe => safe),
		);

/* Expressing both Boolean literals through equality to true makes their distinction visible to the solver. */
const Bool = {
	atom: (op: IVL.AtomOp, args: [IVL.Term, IVL.Term], origin?: string): IVL.Formula =>
		match([op, ...args] as const)
			.with([P.union("=", "!="), Patterns.Term.Bool, Patterns.Term.Bool], ([op, l, r]) => Bool.truth((l.value === r.value) === (op === "="), origin))
			.with([P.union("=", "!="), Patterns.Term.Bool, P._], ([op, l, r]) => Bool.literal(op, r, l.value, origin))
			.with([P.union("=", "!="), P._, Patterns.Term.Bool], ([op, l, r]) => Bool.literal(op, l, r.value, origin))
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
