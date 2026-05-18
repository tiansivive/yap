import type { IVL } from "./types";

export namespace Build {
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

	export const atom = (op: IVL.AtomOp, left: IVL.Term, right: IVL.Term, origin?: string): IVL.Formula => ({
		tag: "Atom",
		op,
		args: [left, right],
		origin,
	});

	export const not = (value: IVL.Formula, origin?: string): IVL.Formula => {
		if (value.tag === "Not") {
			return { ...value.value, origin: origin ?? value.value.origin };
		}

		if (value.tag === "True") {
			return false_(origin);
		}

		if (value.tag === "False") {
			return true_(origin);
		}
		return { tag: "Not", value, origin };
	};

	export const and = (...formulas: IVL.Formula[]): IVL.Formula => andWithOrigin(formulas);

	export const andWithOrigin = (formulas: IVL.Formula[], origin?: string): IVL.Formula => {
		const flat: IVL.Formula[] = [];
		for (const f of formulas) {
			if (f.tag === "False") {
				return false_(origin);
			}

			if (f.tag === "True") {
				continue;
			}

			if (f.tag === "And") {
				flat.push(...f.values);
			} else {
				flat.push(f);
			}
		}

		if (flat.length === 0) {
			return true_(origin);
		}

		if (flat.length === 1) {
			return { ...flat[0], origin: origin ?? flat[0].origin };
		}
		return { tag: "And", values: flat, origin };
	};

	export const or = (...formulas: IVL.Formula[]): IVL.Formula => orWithOrigin(formulas);

	export const orWithOrigin = (formulas: IVL.Formula[], origin?: string): IVL.Formula => {
		const flat: IVL.Formula[] = [];
		for (const f of formulas) {
			if (f.tag === "True") {
				return true_(origin);
			}

			if (f.tag === "False") {
				continue;
			}

			if (f.tag === "Or") {
				flat.push(...f.values);
			} else {
				flat.push(f);
			}
		}

		if (flat.length === 0) {
			return false_(origin);
		}

		if (flat.length === 1) {
			return { ...flat[0], origin: origin ?? flat[0].origin };
		}
		return { tag: "Or", values: flat, origin };
	};

	export const implies = (left: IVL.Formula, right: IVL.Formula, origin?: string): IVL.Formula => {
		if (left.tag === "True") {
			return { ...right, origin: origin ?? right.origin };
		}

		if (left.tag === "False") {
			return true_(origin);
		}

		if (right.tag === "True") {
			return true_(origin);
		}
		return { tag: "Implies", left, right, origin };
	};

	export const forall = (binders: IVL.Binder[], body: IVL.Formula, origin?: string, triggers?: IVL.Trigger[]): IVL.Formula => {
		if (binders.length === 0) {
			return { ...body, origin: origin ?? body.origin };
		}

		if (body.tag === "True") {
			return true_(origin);
		}
		return { tag: "Forall", binders, body, triggers, origin };
	};

	export const exists = (binders: IVL.Binder[], body: IVL.Formula, origin?: string): IVL.Formula => {
		if (binders.length === 0) {
			return { ...body, origin: origin ?? body.origin };
		}

		if (body.tag === "True") {
			return true_(origin);
		}
		return { tag: "Exists", binders, body, origin };
	};
}
