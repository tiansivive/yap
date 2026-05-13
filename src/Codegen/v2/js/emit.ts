import { match } from "ts-pattern";
import type * as MIR from "../../../lowering/mir";
import type { Literal } from "@yap/shared/literals";
import * as JS from "./js";

const PRIMOP_JS: Record<string, { op: string; kind: "binary" | "unary" }> = {
	$add: { op: "+", kind: "binary" },
	$sub: { op: "-", kind: "binary" },
	$mul: { op: "*", kind: "binary" },
	$div: { op: "/", kind: "binary" },
	$mod: { op: "%", kind: "binary" },
	$and: { op: "&&", kind: "binary" },
	$or: { op: "||", kind: "binary" },
	$not: { op: "!", kind: "unary" },
	$eq: { op: "===", kind: "binary" },
	$neq: { op: "!==", kind: "binary" },
	$lt: { op: "<", kind: "binary" },
	$gt: { op: ">", kind: "binary" },
	$lte: { op: "<=", kind: "binary" },
	$gte: { op: ">=", kind: "binary" },
	$concat: { op: "+", kind: "binary" },
};

export function emit(mod: MIR.Module): JS.Program {
	const decls = mod.functions.map(emitFunction);
	return JS.Program(decls, [JS.Return(JS.Call(JS.Id("main"), []))]);
}

function emitFunction(fn: MIR.Function): JS.Decl {
	const blocks = new Map(fn.blocks.map(b => [b.label, b]));
	const body = fn.blocks.length === 1 ? emitSingleBlock(fn.blocks[0]) : emitMultiBlock(fn, blocks);
	return JS.Fn(fn.name, fn.params, body);
}

function emitSingleBlock(block: MIR.Block): JS.Stmt[] {
	return [...block.instrs.map(emitInstr), ...emitTerminatorSingle(block.terminator)];
}

function emitMultiBlock(fn: MIR.Function, blocks: Map<string, MIR.Block>): JS.Stmt[] {
	const allParams = fn.blocks.flatMap(b => b.params);
	const paramDecls = allParams.map(p => JS.Let(p));

	const cases = fn.blocks.map(block => ({
		test: JS.Lit(block.label),
		body: [...block.instrs.map(emitInstr), ...emitTerminatorMulti(block.terminator, blocks)],
	}));

	return [JS.Let("__block", JS.Lit(fn.entry)), ...paramDecls, JS.While(JS.Lit(true), [JS.Switch(JS.Id("__block"), cases)])];
}

function emitInstr(instr: MIR.Instr): JS.Stmt {
	return match(instr)
		.with({ type: "Let" }, ({ name, expr }) => JS.Const(name, emitExpr(expr)))
		.with({ type: "Read" }, ({ label, target, result }) => JS.Const(result, JS.Member(JS.Id(target), label)))
		.with({ type: "Alloc" }, ({ alloc, result }) => JS.Const(result, JS.Obj(alloc.fields.map(f => ({ key: f.label, value: JS.Id(f.value) })))))
		.with({ type: "Update", mode: "immutable" }, ({ into, result, alloc }) =>
			JS.Const(result, JS.Obj([JS.Spread("", JS.Id(into)), ...alloc.fields.map(f => ({ key: f.label, value: JS.Id(f.value) }))])),
		)
		.with({ type: "Update", mode: "fbip" }, ({ into, updates }) =>
			JS.ExprStmt(updates.reduce<JS.Expr>((_, u) => JS.Assign(JS.Member(JS.Id(into), u.label), JS.Id(u.value)), JS.Lit(null))),
		)
		.with({ type: "Call" }, ({ target, args, result }) =>
			match(target)
				.with({ type: "direct" }, ({ func }) => JS.Const(result, JS.Call(JS.Id(func), args.map(JS.Id))))
				.with({ type: "indirect" }, ({ callee }) => JS.Const(result, JS.Call(JS.Id(callee), args.map(JS.Id))))
				.exhaustive(),
		)
		.exhaustive();
}

function emitExpr(expr: MIR.Expr): JS.Expr {
	return match(expr)
		.with({ type: "Var" }, ({ name }) => JS.Id(name))
		.with({ type: "Lit" }, ({ value }) => emitLiteral(value))
		.with({ type: "FuncRef" }, ({ name }) => JS.Id(name))
		.with({ type: "PrimOp" }, ({ op, args }) => {
			const info = PRIMOP_JS[op];

			if (!info) {
				throw new Error(`emit: unknown primop "${op}"`);
			}
			return info.kind === "unary" ? JS.Un(info.op, JS.Id(args[0])) : JS.Bin(info.op, JS.Id(args[0]), JS.Id(args[1]));
		})
		.exhaustive();
}

function emitLiteral(lit: Literal): JS.Expr {
	return match(lit)
		.with({ type: "Num" }, l => JS.Lit(l.value))
		.with({ type: "Bool" }, l => JS.Lit(l.value))
		.with({ type: "String" }, l => JS.Lit(l.value))
		.with({ type: "unit" }, () => JS.Lit(null))
		.with({ type: "Atom" }, l => JS.Lit(l.value))
		.exhaustive();
}

function emitTerminatorSingle(t: MIR.Terminator): JS.Stmt[] {
	return match(t)
		.with({ type: "Return" }, ({ value }) => [JS.Return(JS.Id(value))])
		.with({ type: "Jump" }, () => {
			throw new Error("emit: Jump in single-block function");
		})
		.with({ type: "Branch" }, () => {
			throw new Error("emit: Branch in single-block function");
		})
		.exhaustive();
}

function emitJump(target: string, args: string[], blocks: Map<string, MIR.Block>): JS.Stmt[] {
	const block = blocks.get(target);

	if (!block) {
		throw new Error(`emit: unknown block "${target}"`);
	}
	const params = block.params;
	const temps = args.map((a, i) => ({ tmp: `__t${i}`, src: a }));
	return [
		...temps.map(({ tmp, src }) => JS.Const(tmp, JS.Id(src))),
		...params.map((p, i) => JS.ExprStmt(JS.Assign(JS.Id(p), JS.Id(temps[i].tmp)))),
		JS.ExprStmt(JS.Assign(JS.Id("__block"), JS.Lit(target))),
		JS.Break,
	];
}

function emitTerminatorMulti(t: MIR.Terminator, blocks: Map<string, MIR.Block>): JS.Stmt[] {
	return match(t)
		.with({ type: "Return" }, ({ value }) => [JS.Return(JS.Id(value))])
		.with({ type: "Jump" }, ({ target, args }) => emitJump(target, args, blocks))
		.with({ type: "Branch" }, ({ scrutinee, cases, default: def }) => {
			const scrutExpr = JS.Call(JS.Id("String"), [JS.Id(scrutinee)]);
			const branches: JS.Stmt[] = cases.map(c => JS.If(JS.Bin("===", scrutExpr, JS.Lit(c.value)), emitJump(c.target, c.args, blocks)));
			if (def) {
				branches.push(...emitJump(def.target, def.args, blocks));
			}
			return branches;
		})
		.exhaustive();
}
