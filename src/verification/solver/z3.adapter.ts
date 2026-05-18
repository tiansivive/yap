import { match } from "ts-pattern";
import type { Context as Z3Context, Expr, Bool, Sort as Z3Sort } from "z3-solver";
import type { IVL } from "./ivl";

export const sortToZ3 = (Z3: Z3Context<"main">, s: IVL.Sort): Z3Sort<"main"> =>
	match(s)
		.with({ tag: "Bool" }, () => Z3.Bool.sort())
		.with({ tag: "Int" }, () => Z3.Int.sort())
		.with({ tag: "Real" }, () => Z3.Real.sort())
		.with({ tag: "String" }, () => Z3.Sort.declare("String"))
		.with({ tag: "Unit" }, () => Z3.Sort.declare("Unit"))
		.with({ tag: "Row" }, () => Z3.Sort.declare("Row"))
		.with({ tag: "Fn" }, ({ args, ret }) => {
			const sorts = [...args.map(a => sortToZ3(Z3, a)), sortToZ3(Z3, ret)] as [Z3Sort<"main">, ...Z3Sort<"main">[], Z3Sort<"main">];
			return Z3.Array.sort(...sorts);
		})
		.with({ tag: "Uninterpreted" }, ({ name }) => Z3.Sort.declare(name))
		.exhaustive();

export const termToZ3 = (Z3: Z3Context<"main">, t: IVL.Term): Expr<"main"> =>
	match(t)
		.with({ tag: "Var" }, ({ name, sort }) => Z3.Const(name, sortToZ3(Z3, sort)))
		.with({ tag: "Const" }, ({ name, sort }) => Z3.Const(name, sortToZ3(Z3, sort)))
		.with({ tag: "Num" }, ({ value, sort }) => (sort.tag === "Int" ? Z3.Int.val(value) : Z3.Real.val(value)))
		.with({ tag: "Bool" }, ({ value }) => Z3.Bool.val(value))
		.with({ tag: "Str" }, ({ value }) => Z3.Const(value, Z3.Sort.declare("String")))
		.with({ tag: "Arith" }, ({ op, args: [l, r] }) => {
			const lz = termToZ3(Z3, l) as ReturnType<typeof Z3.Int.val>;
			const rz = termToZ3(Z3, r) as ReturnType<typeof Z3.Int.val>;
			return match(op)
				.with("+", () => lz.add(rz))
				.with("-", () => lz.sub(rz))
				.with("*", () => lz.mul(rz))
				.with("/", () => lz.div(rz))
				.exhaustive();
		})
		.with({ tag: "App" }, ({ head, args, sort }) => {
			if (args.length === 0) {
				return Z3.Const(head, sortToZ3(Z3, sort));
			}
			const fnSort = { tag: "Fn" as const, args: args.map(inferTermSort), ret: sort };
			const fn = Z3.Array.const(
				head,
				...(args.map(a => sortToZ3(Z3, inferTermSort(a))).concat([sortToZ3(Z3, sort)]) as [Z3Sort<"main">, ...Z3Sort<"main">[], Z3Sort<"main">]),
			);
			const [first, ...rest] = args.map(a => termToZ3(Z3, a));
			return fn.select(first, ...rest);
		})
		.with({ tag: "Select" }, ({ array, index }) => {
			const az = termToZ3(Z3, array) as ReturnType<typeof Z3.Array.const>;
			const iz = termToZ3(Z3, index);
			return az.select(iz);
		})
		.with({ tag: "Row" }, ({ sort }) => Z3.Const("row", sortToZ3(Z3, sort)))
		.exhaustive();

export const formulaToZ3 = (Z3: Z3Context<"main">, f: IVL.Formula): Expr<"main"> =>
	match(f)
		.with({ tag: "True" }, () => Z3.Bool.val(true) as Expr<"main">)
		.with({ tag: "False" }, () => Z3.Bool.val(false) as Expr<"main">)
		.with({ tag: "Atom" }, ({ op, args: [l, r] }) => {
			const lz = termToZ3(Z3, l);
			const rz = termToZ3(Z3, r);
			return match(op)
				.with("=", () => lz.eq(rz))
				.with("!=", () => lz.neq(rz))
				.with("<", () => (lz as ReturnType<typeof Z3.Int.val>).lt(rz as ReturnType<typeof Z3.Int.val>))
				.with("<=", () => (lz as ReturnType<typeof Z3.Int.val>).le(rz as ReturnType<typeof Z3.Int.val>))
				.with(">", () => (lz as ReturnType<typeof Z3.Int.val>).gt(rz as ReturnType<typeof Z3.Int.val>))
				.with(">=", () => (lz as ReturnType<typeof Z3.Int.val>).ge(rz as ReturnType<typeof Z3.Int.val>))
				.exhaustive();
		})
		.with({ tag: "Not" }, ({ value }) => (formulaToZ3(Z3, value) as Bool<"main">).not())
		.with({ tag: "And" }, ({ values }) => {
			const exprs = values.map(v => formulaToZ3(Z3, v) as Bool<"main">);

			if (exprs.length === 0) {
				return Z3.Bool.val(true) as Expr<"main">;
			}

			if (exprs.length === 1) {
				return exprs[0] as Expr<"main">;
			}
			return Z3.And(exprs[0], ...exprs.slice(1));
		})
		.with({ tag: "Or" }, ({ values }) => {
			const exprs = values.map(v => formulaToZ3(Z3, v) as Bool<"main">);

			if (exprs.length === 0) {
				return Z3.Bool.val(false) as Expr<"main">;
			}

			if (exprs.length === 1) {
				return exprs[0] as Expr<"main">;
			}
			return Z3.Or(exprs[0], ...exprs.slice(1));
		})
		.with({ tag: "Implies" }, ({ left, right }) => Z3.Implies(formulaToZ3(Z3, left) as Bool<"main">, formulaToZ3(Z3, right) as Bool<"main">))
		.with({ tag: "Forall" }, ({ binders, body }) => {
			const [first, ...rest] = binders.map(b => Z3.Const(b.name, sortToZ3(Z3, b.sort)));
			return Z3.ForAll([first, ...rest], formulaToZ3(Z3, body) as Bool<"main">);
		})
		.with({ tag: "Exists" }, ({ binders, body }) => {
			const [first, ...rest] = binders.map(b => Z3.Const(b.name, sortToZ3(Z3, b.sort)));
			return Z3.Exists([first, ...rest], formulaToZ3(Z3, body) as Bool<"main">);
		})
		.exhaustive();

export const solve = async (Z3: Z3Context<"main">, formula: IVL.Formula): Promise<"sat" | "unsat" | "unknown"> => {
	const solver = new Z3.Solver();
	const expr = formulaToZ3(Z3, formula);
	solver.add(expr.eq(Z3.Bool.val(true)));
	return solver.check();
};

const inferTermSort = (t: IVL.Term): IVL.Sort =>
	match(t)
		.with({ tag: "Var" }, ({ sort }) => sort)
		.with({ tag: "Const" }, ({ sort }) => sort)
		.with({ tag: "Num" }, ({ sort }) => sort)
		.with({ tag: "Bool" }, () => ({ tag: "Bool" }) as IVL.Sort)
		.with({ tag: "Str" }, () => ({ tag: "String" }) as IVL.Sort)
		.with({ tag: "Arith" }, ({ sort }) => sort)
		.with({ tag: "App" }, ({ sort }) => sort)
		.with({ tag: "Select" }, ({ sort }) => sort)
		.with({ tag: "Row" }, ({ sort }) => sort)
		.exhaustive();
