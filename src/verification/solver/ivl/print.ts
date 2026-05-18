import { match } from "ts-pattern";
import type { IVL } from "./types";

export namespace Print {
	export const sort = (s: IVL.Sort): string =>
		match(s)
			.with({ tag: "Bool" }, () => "Bool")
			.with({ tag: "Int" }, () => "Int")
			.with({ tag: "Real" }, () => "Real")
			.with({ tag: "String" }, () => "String")
			.with({ tag: "Unit" }, () => "Unit")
			.with({ tag: "Row" }, () => "Row")
			.with({ tag: "Fn" }, ({ args, ret }) => `(Fn (${args.map(sort).join(" ")}) ${sort(ret)})`)
			.with({ tag: "Uninterpreted" }, ({ name }) => name)
			.exhaustive();

	export const rowTerm = (r: IVL.RowTerm): string =>
		match(r)
			.with({ tag: "Empty" }, () => "row-empty")
			.with({ tag: "Extend" }, ({ label, value, rest }) => `(row-extend ${label} ${term(value)} ${rowTerm(rest)})`)
			.with({ tag: "Var" }, ({ name }) => name)
			.exhaustive();

	export const term = (t: IVL.Term): string =>
		match(t)
			.with({ tag: "Var" }, ({ name }) => name)
			.with({ tag: "Const" }, ({ name }) => name)
			.with({ tag: "Num" }, ({ value }) => value)
			.with({ tag: "Bool" }, ({ value }) => (value ? "true" : "false"))
			.with({ tag: "Str" }, ({ value }) => `"${value}"`)
			.with({ tag: "Arith" }, ({ op, args: [l, r] }) => `(${op} ${term(l)} ${term(r)})`)
			.with({ tag: "App" }, ({ head, args }) => (args.length === 0 ? head : `(${head} ${args.map(term).join(" ")})`))
			.with({ tag: "Select" }, ({ array, index }) => `(select ${term(array)} ${term(index)})`)
			.with({ tag: "Row" }, ({ row }) => rowTerm(row))
			.exhaustive();

	export const formula = (f: IVL.Formula): string => {
		const origin = f.origin ? ` ; ${f.origin}` : "";
		const inner = match(f)
			.with({ tag: "True" }, () => "true")
			.with({ tag: "False" }, () => "false")
			.with({ tag: "Atom" }, ({ op, args: [l, r] }) => `(${op} ${term(l)} ${term(r)})`)
			.with({ tag: "Not" }, ({ value }) => `(not ${formula(value)})`)
			.with({ tag: "And" }, ({ values }) => `(and ${values.map(formula).join(" ")})`)
			.with({ tag: "Or" }, ({ values }) => `(or ${values.map(formula).join(" ")})`)
			.with({ tag: "Implies" }, ({ left, right }) => `(=> ${formula(left)} ${formula(right)})`)
			.with({ tag: "Forall" }, ({ binders, body }) => `(forall (${binders.map(binder).join(" ")}) ${formula(body)})`)
			.with({ tag: "Exists" }, ({ binders, body }) => `(exists (${binders.map(binder).join(" ")}) ${formula(body)})`)
			.exhaustive();
		return inner + origin;
	};

	const binder = (b: IVL.Binder): string => `(${b.name} ${sort(b.sort)})`;
}
