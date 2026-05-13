import { match } from "ts-pattern";
import { js as beautify } from "js-beautify";
import type { Expr, Stmt, Decl, Program } from "./js";

export function print(program: Program): string {
	const raw = [...program.declarations.map(printDecl), ...program.body.map(printStmt)].join("\n");
	return beautify(raw, { indent_size: 2, end_with_newline: true });
}

function printDecl(decl: Decl): string {
	const params = decl.params.join(", ");
	const body = decl.body.map(printStmt).join("\n");
	return `function ${decl.name}(${params}) {\n${body}\n}`;
}

function printStmt(stmt: Stmt): string {
	return match(stmt)
		.with({ type: "Const" }, ({ name, value }) => `const ${name} = ${printExpr(value)};`)
		.with({ type: "Let" }, ({ name, value }) => (value ? `let ${name} = ${printExpr(value)};` : `let ${name};`))
		.with({ type: "ExprStmt" }, ({ expr }) => `${printExpr(expr)};`)
		.with({ type: "Return" }, ({ value }) => `return ${printExpr(value)};`)
		.with({ type: "If" }, ({ condition, body }) => `if (${printExpr(condition)}) {\n${body.map(printStmt).join("\n")}\n}`)
		.with({ type: "Switch" }, ({ discriminant, cases }) => {
			const body = cases
				.map(c => {
					const isDefault = c.test.type === "Literal" && c.test.value === "__default__";
					const header = isDefault ? "default:" : `case ${printExpr(c.test)}:`;
					const stmts = c.body.map(printStmt).join("\n");
					return `${header} {\n${stmts}\n}`;
				})
				.join("\n");
			return `switch (${printExpr(discriminant)}) {\n${body}\n}`;
		})
		.with({ type: "While" }, ({ condition, body }) => `while (${printExpr(condition)}) {\n${body.map(printStmt).join("\n")}\n}`)
		.with({ type: "Break" }, () => "break;")
		.exhaustive();
}

function printExpr(expr: Expr): string {
	return match(expr)
		.with({ type: "Literal" }, ({ value }) => (value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : String(value)))
		.with({ type: "Identifier" }, ({ name }) => name)
		.with({ type: "Binary" }, ({ op, left, right }) => `(${printExpr(left)} ${op} ${printExpr(right)})`)
		.with({ type: "Unary" }, ({ op, arg }) => `(${op}${printExpr(arg)})`)
		.with({ type: "Call" }, ({ callee, args }) => `${printExpr(callee)}(${args.map(printExpr).join(", ")})`)
		.with({ type: "Member" }, ({ object, property }) => `${printExpr(object)}.${property}`)
		.with({ type: "Object" }, ({ fields }) => {
			const entries = fields.map(f => (f.spread ? `...${printExpr(f.value)}` : `${f.key}: ${printExpr(f.value)}`));
			return `{${entries.join(", ")}}`;
		})
		.with({ type: "Assign" }, ({ target, value }) => `(${printExpr(target)} = ${printExpr(value)})`)
		.exhaustive();
}
