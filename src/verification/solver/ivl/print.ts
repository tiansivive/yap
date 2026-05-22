import { match } from "ts-pattern";
import * as PP from "@yap/shared/pretty";
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

	const binder = (b: IVL.Binder): string => `(${b.name} ${sort(b.sort)})`;

	const formulaDoc = (f: IVL.Formula): PP.Doc => {
		const origin: PP.Doc = f.origin ? ` ; ${f.origin}` : [];
		const inner: PP.Doc = match(f)
			.with({ tag: "True" }, () => "true")
			.with({ tag: "False" }, () => "false")
			.with({ tag: "Atom" }, ({ op, args: [l, r] }) => `(${op} ${term(l)} ${term(r)})`)
			.with({ tag: "Not" }, ({ value }) => PP.group(["(not ", PP.nest(5, formulaDoc(value)), ")"]))
			.with({ tag: "And" }, ({ values }) =>
				PP.group([
					"(and",
					PP.nest(
						2,
						values.map(v => [PP.line, formulaDoc(v)]),
					),
					")",
				]),
			)
			.with({ tag: "Or" }, ({ values }) =>
				PP.group([
					"(or",
					PP.nest(
						2,
						values.map(v => [PP.line, formulaDoc(v)]),
					),
					")",
				]),
			)
			.with({ tag: "Implies" }, ({ left, right }) => PP.group(["(=>", PP.nest(2, [PP.line, formulaDoc(left), PP.line, formulaDoc(right)]), ")"]))
			.with({ tag: "Forall" }, ({ binders: bs, body }) =>
				PP.group(["(forall (", ...PP.intersperse(" ", bs.map(binder)), ")", PP.nest(2, [PP.line, formulaDoc(body)]), ")"]),
			)
			.with({ tag: "Exists" }, ({ binders: bs, body }) =>
				PP.group(["(exists (", ...PP.intersperse(" ", bs.map(binder)), ")", PP.nest(2, [PP.line, formulaDoc(body)]), ")"]),
			)
			.exhaustive();

		return [inner, origin];
	};

	export const formula = (f: IVL.Formula): string => PP.render(formulaDoc(f));
}
