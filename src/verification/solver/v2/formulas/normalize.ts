// Formula normalization for the v2 solver pipeline.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

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
		.with(Patterns.Formula.Atom, ({ op, args, origin }) => Lift.args(args.map(normalizeTerm), ([left, right]) => Bool.atom(op, [left, right], origin), origin))
		.exhaustive();

/* Splitting at the containing atom keeps each formula value inside its original binders. */
const Lift = {
	term: (term: IVL.Term, body: (term: IVL.Term) => IVL.Formula, origin?: string): IVL.Formula =>
		match(term)
			.with(Patterns.Term.Prop, ({ value }) => {
				const condition = normalize(value);
				return Build.orWithOrigin([Build.and(condition, body(Build.bool(true))), Build.and(Build.not(condition), body(Build.bool(false)))], origin);
			})
			.with(Patterns.Term.App, ({ head, args, sort }) => Lift.args(args, terms => body(Build.app(head, terms, sort)), origin))
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Lift.args(args, ([left, right]) => body(Build.arith(op, left, right, sort)), origin))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Lift.args([array, index], ([a, i]) => body(Build.select(a, i, sort)), origin))
			.with(Patterns.Term.Row, ({ row, sort }) => Lift.row(row, fields => body(Build.row(fields, sort)), origin))
			.with(Patterns.Term.Var, Patterns.Term.Const, Patterns.Term.Num, Patterns.Term.Bool, Patterns.Term.Str, body)
			.exhaustive(),

	args: (terms: IVL.Term[], body: (terms: IVL.Term[]) => IVL.Formula, origin?: string): IVL.Formula =>
		match(terms.findIndex(Prop.contains))
			.with(-1, () => body(terms))
			.otherwise(index =>
				Lift.term(terms[index], value => Lift.args(terms.slice(index + 1), tail => body([...terms.slice(0, index), value, ...tail]), origin), origin),
			),

	row: (row: IVL.RowTerm, body: (row: IVL.RowTerm) => IVL.Formula, origin?: string): IVL.Formula =>
		match(row)
			.with(Patterns.Row.Extend, ({ label, value, rest }) =>
				Lift.term(value, field => Lift.row(rest, tail => body(Build.rowExtend(label, field, tail)), origin), origin),
			)
			.with(Patterns.Row.Empty, Patterns.Row.Var, body)
			.exhaustive(),
};

const triggers = (hints: IVL.Trigger[] | undefined): IVL.Trigger[] | undefined =>
	match(hints)
		.with(undefined, () => undefined)
		.with([], () => [])
		.otherwise(hints =>
			match(hints.filter(({ terms }) => !terms.some(Prop.contains)))
				.with([], () => undefined)
				.otherwise(safe => safe),
		);

const Prop = {
	contains: (term: IVL.Term): boolean =>
		match(term)
			.with(Patterns.Term.Prop, () => true)
			.with(Patterns.Term.App, Patterns.Term.Arith, ({ args }) => args.some(Prop.contains))
			.with(Patterns.Term.Select, ({ array, index }) => Prop.contains(array) || Prop.contains(index))
			.with(Patterns.Term.Row, ({ row }) => Prop.row(row))
			.with(Patterns.Term.Var, Patterns.Term.Const, Patterns.Term.Num, Patterns.Term.Bool, Patterns.Term.Str, () => false)
			.exhaustive(),

	row: (row: IVL.RowTerm): boolean =>
		match(row)
			.with(Patterns.Row.Extend, ({ value, rest }) => Prop.contains(value) || Prop.row(rest))
			.with(Patterns.Row.Empty, Patterns.Row.Var, () => false)
			.exhaustive(),
};

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
