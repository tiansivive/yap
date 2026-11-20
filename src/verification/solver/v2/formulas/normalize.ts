// Formula normalization for the v2 solver pipeline.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { findFirstMap } from "fp-ts/ReadonlyArray";
import { pipe } from "fp-ts/function";
import { match, P } from "ts-pattern";
import { Build } from "../../ivl/build";
import { Patterns } from "../../ivl/patterns";
import type { IVL } from "../../ivl/types";

type Normal = IVL.Formula | IVL.Hole;

const combine = <A>(parts: readonly A[], visit: (part: A) => Normal, build: (parts: readonly IVL.Formula[]) => IVL.Formula): Normal =>
	pipe(
		parts,
		E.traverseArray((part: A) => {
			const value = visit(part);
			return value.tag === "Hole" ? E.left(value) : E.right(value);
		}),
		E.match<IVL.Hole, readonly IVL.Formula[], Normal>(hole => hole, build),
	);

export const normalize = (formula: IVL.Formula): Normal =>
	match(formula)
		.with(Patterns.Formula.True, Patterns.Formula.False, f => f)
		.with(Patterns.Formula.Not, ({ value, origin }) => combine([value], normalize, ([f]) => Build.not(f, origin)))
		.with(Patterns.Formula.And, ({ values, origin }) => combine(values, normalize, fs => Build.andWithOrigin([...fs], origin)))
		.with(Patterns.Formula.Or, ({ values, origin }) => combine(values, normalize, fs => Build.orWithOrigin([...fs], origin)))
		.with(Patterns.Formula.Implies, ({ left, right, origin }) => combine([left, right], normalize, ([a, b]) => Build.implies(a, b, origin)))
		.with(Patterns.Formula.Forall, ({ binders, body, triggers: hints, origin }) => {
			const inner = normalize(body);
			if (inner.tag === "Hole") {
				return inner;
			}
			const safe = triggers(hints);
			return safe && "tag" in safe ? safe : Build.forall(binders, inner, origin, safe);
		})
		.with(Patterns.Formula.Exists, ({ binders, body, origin }) => combine([body], normalize, ([f]) => Build.exists(binders, f, origin)))
		.with(Patterns.Formula.Atom, ({ op, args, origin }) => Lift.args(args.map(normalizeTerm), ([left, right]) => Bool.atom(op, [left, right], origin), origin))
		.exhaustive();

/* Splitting at the containing atom keeps each formula value inside its original binders. */
const Lift = {
	term: (term: IVL.Term, body: (term: IVL.Term) => Normal, origin?: string): Normal =>
		match(term)
			.with(Patterns.Term.Hole, hole => hole)
			.with(Patterns.Term.Prop, ({ value }) => {
				const condition = normalize(value);
				if (condition.tag === "Hole") {
					return condition;
				}
				return combine(
					[true, false],
					b => body(Build.bool(b)),
					([yes, no]) => Build.orWithOrigin([Build.and(condition, yes), Build.and(Build.not(condition), no)], origin),
				);
			})
			.with(Patterns.Term.App, ({ head, args, sort }) => Lift.args(args, terms => body(Build.app(head, terms, sort)), origin))
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Lift.args(args, ([left, right]) => body(Build.arith(op, left, right, sort)), origin))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Lift.args([array, index], ([a, i]) => body(Build.select(a, i, sort)), origin))
			.with(Patterns.Term.Row, ({ row, sort }) => Lift.row(row, fields => body(Build.row(fields, sort)), origin))
			.with(Patterns.Term.Var, Patterns.Term.Const, Patterns.Term.Num, Patterns.Term.Bool, Patterns.Term.Str, body)
			.exhaustive(),

	args: (terms: IVL.Term[], body: (terms: IVL.Term[]) => Normal, origin?: string): Normal =>
		match(terms.findIndex(t => embedded(t) !== undefined))
			.with(-1, () => body(terms))
			.otherwise(index =>
				Lift.term(terms[index], value => Lift.args(terms.slice(index + 1), tail => body([...terms.slice(0, index), value, ...tail]), origin), origin),
			),

	row: (row: IVL.RowTerm, body: (row: IVL.RowTerm) => Normal, origin?: string): Normal =>
		match(row)
			.with(Patterns.Row.Extend, ({ label, value, rest }) =>
				Lift.term(value, field => Lift.row(rest, tail => body(Build.rowExtend(label, field, tail)), origin), origin),
			)
			.with(Patterns.Row.Empty, Patterns.Row.Var, body)
			.exhaustive(),
};

type Embedded = IVL.Hole | Extract<IVL.Term, { tag: "Prop" }>;

const first = <T, A>(values: readonly T[], read: (value: T) => A | undefined): A | undefined =>
	pipe(
		values,
		findFirstMap((value: T) => O.fromNullable(read(value))),
		O.toUndefined,
	);

const embedded = (term: IVL.Term | IVL.RowTerm): Embedded | undefined =>
	match(term)
		.with(Patterns.Term.Hole, Patterns.Term.Prop, value => value)
		.with(Patterns.Term.App, Patterns.Term.Arith, ({ args }) => first(args, embedded))
		.with(Patterns.Term.Select, ({ array, index }) => embedded(array) ?? embedded(index))
		.with(Patterns.Term.Row, ({ row }) => embedded(row))
		.with(Patterns.Row.Extend, ({ value, rest }) => embedded(value) ?? embedded(rest))
		.with(Patterns.Term.Var, Patterns.Term.Const, Patterns.Term.Num, Patterns.Term.Bool, Patterns.Term.Str, Patterns.Row.Empty, () => undefined)
		.exhaustive();

const triggers = (hints: IVL.Trigger[] | undefined): IVL.Hole | IVL.Trigger[] | undefined => {
	if (!hints?.length) {
		return hints;
	}
	return pipe(
		hints,
		E.traverseArray((hint: IVL.Trigger) => {
			const value = first(hint.terms, embedded);
			return value?.tag === "Hole" ? E.left(value) : E.right(value ? undefined : hint);
		}),
		E.matchW(
			(hole: IVL.Hole) => hole,
			(groups: readonly (IVL.Trigger | undefined)[]) => {
				const safe = groups.filter(hint => hint !== undefined);
				return safe.length ? safe : undefined;
			},
		),
	);
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
