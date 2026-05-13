import { match } from "ts-pattern";
import type * as MIR from "../../../lowering/mir";
import type { Literal } from "@yap/shared/literals";
import path from "path";
import * as C from "./ast";

const RT_DIR = path.resolve(__dirname, "rt");

const PRIMOP_C: Record<string, { fn: string; kind: "binary" | "unary" }> = {
	$add: { fn: "yap_add", kind: "binary" },
	$sub: { fn: "yap_sub", kind: "binary" },
	$mul: { fn: "yap_mul", kind: "binary" },
	$div: { fn: "yap_div", kind: "binary" },
	$mod: { fn: "yap_mod", kind: "binary" },
	$and: { fn: "yap_and", kind: "binary" },
	$or: { fn: "yap_or", kind: "binary" },
	$not: { fn: "yap_not", kind: "unary" },
	$eq: { fn: "yap_eq", kind: "binary" },
	$neq: { fn: "yap_neq", kind: "binary" },
	$lt: { fn: "yap_lt", kind: "binary" },
	$gt: { fn: "yap_gt", kind: "binary" },
	$lte: { fn: "yap_lte", kind: "binary" },
	$gte: { fn: "yap_gte", kind: "binary" },
	$concat: { fn: "yap_concat", kind: "binary" },
};

const s = (name: string): string => name.replace(/[^a-zA-Z0-9_]/g, "_");
const V = (name: string, init?: C.Expr) => C.Var("YapValue", s(name), init);

export function emit(mod: MIR.Module): C.Program {
	const fns = mod.functions.map(emitFunction);
	const main = emitMain();
	const items: C.TopLevel[] = [C.Include(path.join(RT_DIR, "yap_rt.h")), ...fns.map(C.Forward), ...fns, main];
	return C.Program(items);
}

export { RT_DIR };

function emitMain(): C.Function {
	return C.Fn(
		"main",
		[],
		[
			C.ExprStmt(C.Invoke("yap_arena_init", [])),
			C.Var("YapValue", "__result", C.Invoke("yap_main", [])),
			C.ExprStmt(C.Invoke("yap_print_value", [C.Id("__result")])),
			C.ExprStmt(C.Invoke("printf", [C.Str("\\n")])),
			C.ExprStmt(C.Invoke("yap_arena_free", [])),
			C.Return(C.Num(0)),
		],
		{ returnType: "int", isStatic: false },
	);
}

function emitFunction(fn: MIR.Function): C.Function {
	const blocks = new Map(fn.blocks.map(b => [b.label, b]));
	const isMain = fn.name === "main";

	const name = isMain ? "yap_main" : s(fn.name);
	const params = isMain
		? []
		: [
				{ typeName: "YapValue*", name: "__args" },
				{ typeName: "int", name: "__argc" },
			];
	const argUnpack = isMain ? [] : fn.params.map((p, i) => V(p, C.Index(C.Id("__args"), C.Num(i))));

	const body = fn.blocks.length === 1 ? emitSingleBlock(fn.blocks[0]) : emitMultiBlock(fn, blocks);

	return C.Fn(name, params, [...argUnpack, ...body]);
}

function emitSingleBlock(block: MIR.Block): C.Stmt[] {
	return [...block.instrs.flatMap(emitInstr), ...emitTerminatorSingle(block.terminator)];
}

function emitMultiBlock(fn: MIR.Function, blocks: Map<string, MIR.Block>): C.Stmt[] {
	const labelIndex = new Map(fn.blocks.map((b, i) => [b.label, i]));
	const allParams = fn.blocks.flatMap(b => b.params);
	const paramDecls = allParams.map(p => V(p));

	const cases = fn.blocks.map(block => ({
		value: labelIndex.get(block.label)!,
		body: [...block.instrs.flatMap(emitInstr), ...emitTerminatorMulti(block.terminator, blocks, labelIndex)],
	}));

	return [C.Var("int", "yap_pc", C.Num(labelIndex.get(fn.entry)!)), ...paramDecls, C.While(C.Num(1), [C.Switch(C.Id("yap_pc"), cases)])];
}

function emitInstr(instr: MIR.Instr): C.Stmt[] {
	return match(instr)
		.with({ type: "Let" }, ({ name, expr }) => [V(name, emitExpr(expr))])
		.with({ type: "Read" }, ({ label, target, result }) => [V(result, C.Invoke("yap_record_get", [C.Id(s(target)), C.Str(label)]))])
		.with({ type: "Alloc" }, ({ alloc, result }) => [
			V(result, C.Invoke("yap_alloc_record", [C.Num(alloc.fields.length)])),
			...alloc.fields.map(f => C.ExprStmt(C.Invoke("yap_record_set", [C.Ref(C.Id(s(result))), C.Str(f.label), C.Id(s(f.value))]))),
		])
		.with({ type: "Update", mode: "immutable" }, ({ into, result, alloc }) => {
			const fields = alloc.fields.map(f => C.Compound("", [C.Str(f.label), C.Id(s(f.value))]));
			return [V(result, C.Invoke("yap_record_copy_with", [C.Id(s(into)), C.Compound("YapField[]", fields), C.Num(alloc.fields.length)]))];
		})
		.with({ type: "Update", mode: "fbip" }, ({ into, updates }) =>
			updates.map(u => C.ExprStmt(C.Invoke("yap_record_set", [C.Ref(C.Id(s(into))), C.Str(u.label), C.Id(s(u.value))]))),
		)
		.with({ type: "Call" }, ({ target, args, result }) =>
			match(target)
				.with({ type: "direct" }, ({ func }) => [
					V(
						result,
						C.Invoke(
							s(func),
							args.map(a => C.Id(s(a))),
						),
					),
				])
				.with({ type: "indirect" }, ({ callee }) => [
					V(
						result,
						C.Invoke("yap_call_closure", [
							C.Id(s(callee)),
							C.Compound(
								"YapValue[]",
								args.map(a => C.Id(s(a))),
							),
							C.Num(args.length),
						]),
					),
				])
				.exhaustive(),
		)
		.exhaustive();
}

function emitExpr(expr: MIR.Expr): C.Expr {
	return match(expr)
		.with({ type: "Var" }, ({ name }) => C.Id(s(name)))
		.with({ type: "Lit" }, ({ value }) => emitLiteral(value))
		.with({ type: "FuncRef" }, ({ name }) => C.Invoke("yap_mk_closure", [C.Ref(C.Id(s(name))), C.Invoke("yap_null", [])]))
		.with({ type: "PrimOp" }, ({ op, args }) => {
			const info = PRIMOP_C[op];

			if (!info) {
				throw new Error(`emit_c: unknown primop "${op}"`);
			}
			return info.kind === "unary" ? C.Invoke(info.fn, [C.Id(s(args[0]))]) : C.Invoke(info.fn, [C.Id(s(args[0])), C.Id(s(args[1]))]);
		})
		.exhaustive();
}

function emitLiteral(lit: Literal): C.Expr {
	return match(lit)
		.with({ type: "Num" }, l => C.Invoke("yap_num", [C.Num(l.value)]))
		.with({ type: "Bool" }, l => C.Invoke("yap_bool", [C.Num(l.value ? 1 : 0)]))
		.with({ type: "String" }, l => C.Invoke("yap_str", [C.Str(l.value)]))
		.with({ type: "unit" }, () => C.Invoke("yap_null", []))
		.with({ type: "Atom" }, l => C.Invoke("yap_atom", [C.Str(l.value)]))
		.exhaustive();
}

function emitTerminatorSingle(t: MIR.Terminator): C.Stmt[] {
	return match(t)
		.with({ type: "Return" }, ({ value }) => [C.Return(C.Id(s(value)))])
		.with({ type: "Jump" }, () => {
			throw new Error("emit_c: Jump in single-block function");
		})
		.with({ type: "Branch" }, () => {
			throw new Error("emit_c: Branch in single-block function");
		})
		.exhaustive();
}

function emitJump(target: string, args: string[], blocks: Map<string, MIR.Block>, labelIndex: Map<string, number>): C.Stmt[] {
	const block = blocks.get(target);

	if (!block) {
		throw new Error(`emit_c: unknown block "${target}"`);
	}
	const params = block.params;
	const temps = args.map((a, i) => ({ tmp: `__t${i}`, src: s(a) }));
	return [
		...temps.map(({ tmp, src }) => C.Var("YapValue", tmp, C.Id(src))),
		...params.map((p, i) => C.ExprStmt(C.Assign(C.Id(s(p)), C.Id(temps[i].tmp)))),
		C.ExprStmt(C.Assign(C.Id("yap_pc"), C.Num(labelIndex.get(target)!))),
		C.Break,
	];
}

function emitTerminatorMulti(t: MIR.Terminator, blocks: Map<string, MIR.Block>, labelIndex: Map<string, number>): C.Stmt[] {
	return match(t)
		.with({ type: "Return" }, ({ value }) => [C.Return(C.Id(s(value)))])
		.with({ type: "Jump" }, ({ target, args }) => emitJump(target, args, blocks, labelIndex))
		.with({ type: "Branch" }, ({ scrutinee, cases, default: def }) => {
			const scrutExpr = C.Invoke("yap_to_str", [C.Id(s(scrutinee))]);
			const branches: C.Stmt[] = cases.map(c => C.If(C.Invoke("yap_streq", [scrutExpr, C.Str(c.value)]), emitJump(c.target, c.args, blocks, labelIndex)));
			if (def) {
				branches.push(C.Block(emitJump(def.target, def.args, blocks, labelIndex)));
			}
			return branches;
		})
		.exhaustive();
}
