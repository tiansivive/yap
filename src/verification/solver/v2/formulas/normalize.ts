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
		.with({ tag: "Atom" }, ({ op, args, origin }) => Build.atom(op, normalizeTerm(args[0]), normalizeTerm(args[1]), origin))
		.exhaustive();

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
