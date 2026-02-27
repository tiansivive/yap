import { match, P } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
import { operatorMap } from "@yap/shared/lib/primitives";
import type { Block, Expr, Function, Instr, Module, Terminator } from "./mir";

const INDENT = "  ";

const d = {
	expr: (expr: Expr): string =>
		match(expr)
			.with({ type: "Var" }, ({ name }) => name)
			.with({ type: "Lit" }, ({ value }) => Lit.display(value))
			.with({ type: "FuncRef" }, ({ name }) => `&${name}`)
			.with({ type: "PrimOp" }, ({ op, args }) => {
				const sym = operatorMap[op] ?? op;
				const argsStr = args.join(", ");
				return `${sym}(${argsStr})`;
			})
			.exhaustive(),

	instr: (instr: Instr): string =>
		match(instr)
			.with({ type: "Let" }, ({ name, expr }) => `let ${name} = ${d.expr(expr)}`)
			.with({ type: "Read" }, ({ label, target, result }) => `let ${result} = read ${target}.${label}`)
			.with({ type: "Update", mode: "immutable" }, ({ into, result, alloc }) => {
				const fieldsStr = alloc.fields.map(f => `${f.label}: ${f.value}`).join(", ");
				return `let ${result} = update-immutable ${into} { ${fieldsStr} }`;
			})
			.with({ type: "Update", mode: "fbip" }, ({ into, updates }) => {
				const fieldsStr = updates.map(f => `${f.label}: ${f.value}`).join(", ");
				return `update-fbip ${into} { ${fieldsStr} }`;
			})
			.with({ type: "Alloc" }, ({ alloc, result }) => {
				const fieldsStr = alloc.fields.map(f => `${f.label}: ${f.value}`).join(", ");
				return `let ${result} = alloc { ${fieldsStr} }`;
			})
			.with({ type: "Call" }, ({ target, args, result }) => {
				const argsStr = args.join(", ");
				const targetStr = target.type === "direct" ? target.func : `*${target.callee}`;
				return `let ${result} = call ${targetStr}(${argsStr})`;
			})
			.exhaustive(),

	terminator: (t: Terminator): string =>
		match(t)
			.with({ type: "Return" }, ({ value }) => `return ${value}`)
			.with({ type: "Jump" }, ({ target, args }) => {
				const argsStr = args.length > 0 ? `(${args.join(", ")})` : "";
				return `jump ${target}${argsStr}`;
			})
			.with({ type: "Branch" }, ({ cond, thenTarget, thenArgs, elseTarget, elseArgs }) => {
				const thenStr = thenArgs.length > 0 ? `(${thenArgs.join(", ")})` : "";
				const elseStr = elseArgs.length > 0 ? `(${elseArgs.join(", ")})` : "";
				return `branch ${cond} ? ${thenTarget}${thenStr} : ${elseTarget}${elseStr}`;
			})
			.exhaustive(),

	block: (block: Block): string => {
		const paramsStr = block.params.length > 0 ? `(${block.params.join(", ")})` : "";
		const header = `${block.label}${paramsStr}:`;
		const instrs = block.instrs.map(i => INDENT + d.instr(i));
		const term = INDENT + d.terminator(block.terminator);
		return [header, ...instrs, term].join("\n");
	},

	function: (fn: Function): string => {
		const paramsStr = fn.params.length > 0 ? `(${fn.params.join(", ")})` : "";
		const header = `fn ${fn.name}${paramsStr} entry=${fn.entry}`;
		const blocks = fn.blocks.map(b => INDENT + d.block(b).replace(/\n/g, "\n" + INDENT));
		return [header, ...blocks].join("\n");
	},

	module: (m: Module): string => {
		const fns = m.functions.map(f => INDENT + d.function(f).replace(/\n/g, "\n" + INDENT));
		return ["module", ...fns].join("\n");
	},
};

function displayAny(x: Expr | Instr | Terminator | Block | Function | Module): string {
	return match(x)
		.with({ type: "Var" }, e => d.expr(e))
		.with({ type: "Lit" }, e => d.expr(e))
		.with({ type: "FuncRef" }, e => d.expr(e))
		.with({ type: "PrimOp" }, e => d.expr(e))
		.with({ type: "Let" }, i => d.instr(i))
		.with({ type: "Read" }, i => d.instr(i))
		.with({ type: "Update" }, i => d.instr(i))
		.with({ type: "Alloc" }, i => d.instr(i))
		.with({ type: "Call" }, i => d.instr(i))
		.with({ type: "Return" }, t => d.terminator(t))
		.with({ type: "Jump" }, t => d.terminator(t))
		.with({ type: "Branch" }, t => d.terminator(t))
		.with({ functions: P._ }, m => d.module(m))
		.with({ blocks: P._ }, f => d.function(f))
		.with({ instrs: P._ }, b => d.block(b))
		.exhaustive();
}

export const display = Object.assign(displayAny, d);
