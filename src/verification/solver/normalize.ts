// Formula normalization: simplifies IVL formulas by eliminating trivial constants,
// flattening nested conjunctions/disjunctions, and folding ground arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match } from "ts-pattern";
import { IVL } from "./ivl/types";
import { Build } from "./ivl/build";

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
		.with({ tag: "Arith" }, ({ op, args, sort }) => {
			const l = normalizeTerm(args[0]);
			const r = normalizeTerm(args[1]);

			if (l.tag === "Num" && r.tag === "Num") {
				return foldArith(op, l.value, r.value, sort);
			}

			return Build.arith(op, l, r, sort);
		})
		.otherwise(t => t);

const foldArith = (op: IVL.ArithOp, a: string, b: string, sort: IVL.NumSort): IVL.Term => {
	const na = Number(a);
	const nb = Number(b);

	if (isNaN(na) || isNaN(nb)) {
		return Build.arith(op, Build.num(a, sort), Build.num(b, sort), sort);
	}

	const result = match(op)
		.with("+", () => na + nb)
		.with("-", () => na - nb)
		.with("*", () => na * nb)
		.with("/", () => (nb !== 0 ? na / nb : NaN))
		.exhaustive();

	if (isNaN(result)) {
		return Build.arith(op, Build.num(a, sort), Build.num(b, sort), sort);
	}

	return Build.num(result, sort);
};
