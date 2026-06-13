// Smart constructors for IVL formulas and terms, with optional algebraic
// simplification (constant folding, double-negation elimination, And/Or
// flattening and unit collapse) applied at construction time.
// IVL = Intermediate Verification Language
// https://github.com/tiansivive/z-yap/blob/main/zettels/vc-ir.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/build-simplify-toggle.md

import { match, P } from "ts-pattern";
import type { IVL } from "./types";

export namespace Build {
	// Justification for let: global per-run toggle set by the CLI, explorer config,
	// and test harnesses; threading it as a parameter would change every smart
	// constructor call site across translation, solving, and tests.
	// eslint-disable-next-line no-restricted-syntax, prefer-const
	export let simplify = true;

	// --- Sorts ---
	export const Bool: IVL.Sort = { tag: "Bool" };
	export const Int: IVL.NumSort = { tag: "Int" };
	export const Real: IVL.NumSort = { tag: "Real" };
	export const String: IVL.Sort = { tag: "String" };
	export const Unit: IVL.Sort = { tag: "Unit" };
	export const Row: IVL.Sort = { tag: "Row" };
	export const fn = (args: IVL.Sort[], ret: IVL.Sort): IVL.Sort => ({ tag: "Fn", args, ret });
	export const uninterpreted = (name: string): IVL.Sort => ({ tag: "Uninterpreted", name });

	// --- Row Terms ---
	export const rowEmpty: IVL.RowTerm = { tag: "Empty" };
	export const rowExtend = (label: string, value: IVL.Term, rest: IVL.RowTerm): IVL.RowTerm => ({ tag: "Extend", label, value, rest });
	export const rowVar = (name: string): IVL.RowTerm => ({ tag: "Var", name });

	// --- Terms ---
	export const var_ = (name: string, sort: IVL.Sort): IVL.Term => ({ tag: "Var", name, sort });
	export const const_ = (name: string, sort: IVL.Sort): IVL.Term => ({ tag: "Const", name, sort });
	export const num = (value: string | number, sort: IVL.NumSort): IVL.Term => ({ tag: "Num", value: value.toString(), sort });
	export const bool = (value: boolean): IVL.Term => ({ tag: "Bool", value });
	export const str = (value: string): IVL.Term => ({ tag: "Str", value });
	export const arith = (op: IVL.ArithOp, left: IVL.Term, right: IVL.Term, sort: IVL.NumSort): IVL.Term => ({
		tag: "Arith",
		op,
		args: [left, right],
		sort,
	});
	export const app = (head: string, args: IVL.Term[], sort: IVL.Sort): IVL.Term => ({ tag: "App", head, args, sort });
	export const select = (array: IVL.Term, index: IVL.Term, sort: IVL.Sort): IVL.Term => ({ tag: "Select", array, index, sort });
	export const row = (r: IVL.RowTerm, sort: IVL.Sort): IVL.Term => ({ tag: "Row", row: r, sort });

	// --- Formulas ---
	export const true_ = (origin?: string): IVL.Formula => ({ tag: "True", origin });
	export const false_ = (origin?: string): IVL.Formula => ({ tag: "False", origin });

	export const atom = (op: IVL.AtomOp, left: IVL.Term, right: IVL.Term, origin?: string): IVL.Formula => {
		const folded = simplify ? foldNumericAtom(op, left, right, origin) : undefined;
		return folded ?? { tag: "Atom", op, args: [left, right], origin };
	};

	export const not = (value: IVL.Formula, origin?: string): IVL.Formula =>
		!simplify
			? { tag: "Not", value, origin }
			: match<IVL.Formula, IVL.Formula>(value)
					.with({ tag: "Not" }, ({ value: inner }) => ({ ...inner, origin: origin ?? inner.origin }))
					.with({ tag: "True" }, () => false_(origin))
					.with({ tag: "False" }, () => true_(origin))
					.otherwise(v => ({ tag: "Not", value: v, origin }));

	export const and = (...formulas: IVL.Formula[]): IVL.Formula => andWithOrigin(formulas);

	export const andWithOrigin = (formulas: IVL.Formula[], origin?: string): IVL.Formula => {
		if (simplify && formulas.some(f => f.tag === "False")) {
			return false_(origin);
		}

		const flat = simplify
			? formulas.flatMap(f =>
					match<IVL.Formula, IVL.Formula[]>(f)
						.with({ tag: "True" }, () => [])
						.with({ tag: "And" }, ({ values }) => values)
						.otherwise(g => [g]),
				)
			: [...formulas];

		if (flat.length === 0) {
			return true_(origin);
		}

		if (simplify && flat.length === 1) {
			return { ...flat[0], origin: origin ?? flat[0].origin };
		}
		return { tag: "And", values: flat, origin };
	};

	export const or = (...formulas: IVL.Formula[]): IVL.Formula => orWithOrigin(formulas);

	export const orWithOrigin = (formulas: IVL.Formula[], origin?: string): IVL.Formula => {
		if (simplify && formulas.some(f => f.tag === "True")) {
			return true_(origin);
		}

		const flat = simplify
			? formulas.flatMap(f =>
					match<IVL.Formula, IVL.Formula[]>(f)
						.with({ tag: "False" }, () => [])
						.with({ tag: "Or" }, ({ values }) => values)
						.otherwise(g => [g]),
				)
			: [...formulas];

		if (flat.length === 0) {
			return false_(origin);
		}

		if (simplify && flat.length === 1) {
			return { ...flat[0], origin: origin ?? flat[0].origin };
		}
		return { tag: "Or", values: flat, origin };
	};

	export const implies = (left: IVL.Formula, right: IVL.Formula, origin?: string): IVL.Formula =>
		!simplify
			? { tag: "Implies", left, right, origin }
			: match<readonly [IVL.Formula, IVL.Formula], IVL.Formula>([left, right])
					.with([{ tag: "True" }, P._], () => ({ ...right, origin: origin ?? right.origin }))
					.with([{ tag: "False" }, P._], () => true_(origin))
					.with([P._, { tag: "True" }], () => true_(origin))
					.otherwise(() => ({ tag: "Implies", left, right, origin }));

	export const forall = (binders: IVL.Binder[], body: IVL.Formula, origin?: string, triggers?: IVL.Trigger[]): IVL.Formula => {
		if (binders.length === 0) {
			return { ...body, origin: origin ?? body.origin };
		}
		return !simplify
			? { tag: "Forall", binders, body, triggers, origin }
			: match<IVL.Formula, IVL.Formula>(body)
					.with({ tag: "True" }, () => true_(origin))
					.otherwise(b => ({ tag: "Forall", binders, body: b, triggers, origin }));
	};

	export const exists = (binders: IVL.Binder[], body: IVL.Formula, origin?: string): IVL.Formula => {
		if (binders.length === 0) {
			return { ...body, origin: origin ?? body.origin };
		}
		return !simplify
			? { tag: "Exists", binders, body, origin }
			: match<IVL.Formula, IVL.Formula>(body)
					.with({ tag: "True" }, () => true_(origin))
					.otherwise(b => ({ tag: "Exists", binders, body: b, origin }));
	};

	// Precision boundary: numeric folding compares via float, matching Number(value)
	// parsing in normalize.ts and Rational.fromNumber in the arithmetic theory.
	const foldNumericAtom = (op: IVL.AtomOp, left: IVL.Term, right: IVL.Term, origin?: string): IVL.Formula | undefined =>
		match<readonly [IVL.Term, IVL.Term], IVL.Formula | undefined>([left, right])
			.with([{ tag: "Num" }, { tag: "Num" }], ([l, r]) => {
				const ln = parseFloat(l.value);
				const rn = parseFloat(r.value);

				if (Number.isNaN(ln) || Number.isNaN(rn)) {
					return undefined;
				}
				const result = match(op)
					.with("=", () => ln === rn)
					.with("!=", () => ln !== rn)
					.with("<", () => ln < rn)
					.with("<=", () => ln <= rn)
					.with(">", () => ln > rn)
					.with(">=", () => ln >= rn)
					.exhaustive();
				return result ? true_(origin) : false_(origin);
			})
			.otherwise(() => undefined);
}
