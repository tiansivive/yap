import { match } from "ts-pattern";
import { execSync } from "child_process";
import type { Expr, Stmt, Function, Program, TopLevel } from "./ast";

export function print(program: Program): string {
	const raw = program.items.map(printTopLevel).join("\n\n");
	return format(raw);
}

function format(code: string): string {
	try {
		return execSync("clang-format", { input: code, encoding: "utf-8", timeout: 3000 });
	} catch {
		return code;
	}
}

function printTopLevel(item: TopLevel): string {
	return match(item)
		.with({ type: "Include" }, ({ path }) => `#include "${path}"`)
		.with({ type: "ForwardDecl" }, printForwardDecl)
		.with({ type: "Function" }, printFunction)
		.exhaustive();
}

function printForwardDecl(decl: TopLevel & { type: "ForwardDecl" }): string {
	const stat = decl.isStatic ? "static " : "";
	const params = decl.params.length === 0 ? "void" : decl.params.map(p => `${p.typeName} ${p.name}`).join(", ");
	return `${stat}${decl.returnType} ${decl.name}(${params});`;
}

function printFunction(fn: Function): string {
	const stat = fn.isStatic ? "static " : "";
	const params = fn.params.length === 0 ? "void" : fn.params.map(p => `${p.typeName} ${p.name}`).join(", ");
	const body = fn.body.map(s => indent(printStmt(s))).join("\n");
	return `${stat}${fn.returnType} ${fn.name}(${params}) {\n${body}\n}`;
}

function printStmt(stmt: Stmt): string {
	return match(stmt)
		.with({ type: "VarDecl" }, ({ typeName, name, init }) => (init ? `${typeName} ${name} = ${printExpr(init)};` : `${typeName} ${name};`))
		.with({ type: "ExprStmt" }, ({ expr }) => `${printExpr(expr)};`)
		.with({ type: "Return" }, ({ value }) => `return ${printExpr(value)};`)
		.with({ type: "If" }, ({ condition, body }) => `if (${printExpr(condition)}) {\n${body.map(s => indent(printStmt(s))).join("\n")}\n}`)
		.with({ type: "Switch" }, ({ discriminant, cases }) => {
			const body = cases
				.map(c => {
					const stmts = c.body.map(s => indent(indent(printStmt(s)))).join("\n");
					return `${indent(`case ${c.value}:`)} {\n${stmts}\n${indent("}")}`;
				})
				.join("\n");
			return `switch (${printExpr(discriminant)}) {\n${body}\n}`;
		})
		.with({ type: "While" }, ({ condition, body }) => `while (${printExpr(condition)}) {\n${body.map(s => indent(printStmt(s))).join("\n")}\n}`)
		.with({ type: "Break" }, () => "break;")
		.with({ type: "Block" }, ({ body }) => `{\n${body.map(s => indent(printStmt(s))).join("\n")}\n}`)
		.exhaustive();
}

function printExpr(expr: Expr): string {
	return match(expr)
		.with({ type: "Literal" }, ({ value }) => value)
		.with({ type: "Identifier" }, ({ name }) => name)
		.with({ type: "Call" }, ({ callee, args }) => `${printExpr(callee)}(${args.map(printExpr).join(", ")})`)
		.with({ type: "Index" }, ({ array, index }) => `${printExpr(array)}[${printExpr(index)}]`)
		.with({ type: "Ref" }, ({ target }) => `&${printExpr(target)}`)
		.with({ type: "CompoundLiteral" }, ({ typeName, fields }) =>
			typeName ? `(${typeName}){${fields.map(printExpr).join(", ")}}` : `{${fields.map(printExpr).join(", ")}}`,
		)
		.with({ type: "Cast" }, ({ typeName, expr: e }) => `(${typeName})${printExpr(e)}`)
		.with({ type: "Assign" }, ({ target, value }) => `${printExpr(target)} = ${printExpr(value)}`)
		.exhaustive();
}

const indent = (s: string): string => `  ${s}`;
