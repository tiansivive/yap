import { match } from "ts-pattern";
import type { Expr, Lit, Pattern, Clause, FunDef, Module } from "./ast";

export function print(mod: Module): string {
	const exports = mod.exports.map(e => `'${e.name}'/${e.arity}`).join(", ");
	const defs = mod.defs.map(d => printFunDef(d, 0)).join("\n\n");
	return `module '${mod.name}' [${exports}]\nattributes []\n\n${defs}\nend\n`;
}

function printFunDef(def: FunDef, depth: number): string {
	const params = def.params.join(", ");
	const body = printExpr(def.body, depth + 1);
	return `${pad(depth)}'${def.name}'/${def.arity} = fun (${params}) ->\n${body}`;
}

function printExpr(expr: Expr, depth: number): string {
	return match(expr)
		.with({ type: "Lit" }, ({ value }) => `${pad(depth)}${printLit(value)}`)
		.with({ type: "Var" }, ({ name }) => `${pad(depth)}${name}`)
		.with({ type: "Let" }, ({ vars, value, body }) => {
			const vs = vars.map(v => `<${v}>`).join(", ");
			const val = printExpr(value, 0).trimStart();
			const b = printExpr(body, depth);
			return `${pad(depth)}let ${vs} = ${val}\n${pad(depth)}in ${b.trimStart()}`;
		})
		.with({ type: "Letrec" }, ({ defs, body }) => {
			const ds = defs.map(d => printFunDef(d, depth + 1)).join("\n\n");
			const b = printExpr(body, depth + 1);
			return `${pad(depth)}letrec\n${ds}\n${pad(depth)}in ${b.trimStart()}`;
		})
		.with({ type: "Apply" }, ({ func, args }) => {
			const f = printExpr(func, 0).trimStart();
			const as = args.map(a => printExpr(a, 0).trimStart()).join(", ");
			return `${pad(depth)}apply ${f}(${as})`;
		})
		.with({ type: "Call" }, ({ module: mod, func, args }) => {
			const as = args.map(a => printExpr(a, 0).trimStart()).join(", ");
			return `${pad(depth)}call '${mod}':'${func}'(${as})`;
		})
		.with({ type: "Case" }, ({ expr: e, clauses }) => {
			const scrutinee = printExpr(e, 0).trimStart();
			const cs = clauses.map(c => printClause(c, depth + 1)).join("\n");
			return `${pad(depth)}case ${scrutinee} of\n${cs}\n${pad(depth)}end`;
		})
		.with({ type: "Tuple" }, ({ elements }) => {
			const es = elements.map(e => printExpr(e, 0).trimStart()).join(", ");
			return `${pad(depth)}{${es}}`;
		})
		.with({ type: "Cons" }, ({ head, tail }) => {
			const items = collectList(expr);
			if (items.tail.type === "Nil") {
				const es = items.heads.map(e => printExpr(e, 0).trimStart()).join(", ");
				return `${pad(depth)}[${es}]`;
			}
			const es = items.heads.map(e => printExpr(e, 0).trimStart()).join(", ");
			const t = printExpr(items.tail, 0).trimStart();
			return `${pad(depth)}[${es} | ${t}]`;
		})
		.with({ type: "Nil" }, () => `${pad(depth)}[]`)
		.with({ type: "Fun" }, ({ module: mod, name, arity }) => `${pad(depth)}fun '${mod}':'${name}'/${arity}`)
		.exhaustive();
}

function printClause(clause: Clause, depth: number): string {
	const pat = printPattern(clause.pattern);
	const guard = printExpr(clause.guard, 0).trimStart();
	const body = printExpr(clause.body, depth + 1);
	return `${pad(depth)}<${pat}> when ${guard} ->\n${body}`;
}

function printPattern(pat: Pattern): string {
	return match(pat)
		.with({ type: "PLit" }, ({ value }) => printLit(value))
		.with({ type: "PVar" }, ({ name }) => name)
		.with({ type: "PTuple" }, ({ elements }) => `{${elements.map(printPattern).join(", ")}}`)
		.with({ type: "PWild" }, () => "_")
		.exhaustive();
}

function printLit(lit: Lit): string {
	return match(lit)
		.with({ type: "Int" }, ({ value }) => String(value))
		.with({ type: "Atom" }, ({ value }) => `'${value}'`)
		.with({ type: "String" }, ({ value }) => `"${value}"`)
		.exhaustive();
}

function collectList(expr: Expr): { heads: Expr[]; tail: Expr } {
	const heads: Expr[] = [];
	let current = expr;
	while (current.type === "Cons") {
		heads.push(current.head);
		current = current.tail;
	}
	return { heads, tail: current };
}

const pad = (depth: number): string => "  ".repeat(depth);
