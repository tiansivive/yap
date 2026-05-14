import { match } from "ts-pattern";
import type * as MIR from "../../../lowering/mir";
import type { Literal } from "@yap/shared/literals";
import * as E from "./ast";

const MODULE_NAME = "yap_main";

const PRIMOP_ERL: Record<string, { mod: string; fn: string; kind: "binary" | "unary" }> = {
	$add: { mod: "erlang", fn: "+", kind: "binary" },
	$sub: { mod: "erlang", fn: "-", kind: "binary" },
	$mul: { mod: "erlang", fn: "*", kind: "binary" },
	$div: { mod: "erlang", fn: "div", kind: "binary" },
	$mod: { mod: "erlang", fn: "rem", kind: "binary" },
	$and: { mod: "erlang", fn: "and", kind: "binary" },
	$or: { mod: "erlang", fn: "or", kind: "binary" },
	$not: { mod: "erlang", fn: "not", kind: "unary" },
	$eq: { mod: "erlang", fn: "=:=", kind: "binary" },
	$neq: { mod: "erlang", fn: "=/=", kind: "binary" },
	$lt: { mod: "erlang", fn: "<", kind: "binary" },
	$gt: { mod: "erlang", fn: ">", kind: "binary" },
	$lte: { mod: "erlang", fn: "=<", kind: "binary" },
	$gte: { mod: "erlang", fn: ">=", kind: "binary" },
	$concat: { mod: "erlang", fn: "++", kind: "binary" },
};

const v = (name: string): string => {
	const s = name.replace(/[^a-zA-Z0-9_]/g, "_");
	return s.charAt(0).toUpperCase() + s.slice(1);
};

type Ctx = { arities: Map<string, number> };

export function emit(mod: MIR.Module): E.Module {
	const ctx: Ctx = {
		arities: new Map(mod.functions.map(f => [f.name, f.params.length])),
	};

	const allFns = mod.functions.filter(f => f.name !== "main");
	const mainFn = mod.functions.find(f => f.name === "main");

	if (!mainFn) {
		throw new Error("emit_erl: no main function");
	}

	const defs: E.FunDef[] = [...allFns.map(f => emitFunction(f, ctx)), emitMainFunction(mainFn, ctx)];

	const exports: Array<{ name: string; arity: number }> = [{ name: "main", arity: 0 }, ...allFns.map(f => ({ name: f.name, arity: f.params.length }))];

	return E.Module(MODULE_NAME, exports, defs);
}

function emitMainFunction(fn: MIR.Function, ctx: Ctx): E.FunDef {
	const blocks = new Map(fn.blocks.map(b => [b.label, b]));
	const body = fn.blocks.length === 1 ? emitSingleBlock(fn.blocks[0], ctx) : emitMultiBlock(fn, blocks, ctx);

	const printAndExit = E.Let1("_Print", E.Call("io", "format", [E.Lit(E.Str("~p~n")), E.List([E.Var("_MainResult")])]), E.Lit(E.Atom("ok")));

	return E.FunDef("main", [], E.Let1("_MainResult", body, printAndExit));
}

function emitFunction(fn: MIR.Function, ctx: Ctx): E.FunDef {
	const blocks = new Map(fn.blocks.map(b => [b.label, b]));
	const params = fn.params.map(v);
	const body = fn.blocks.length === 1 ? emitSingleBlock(fn.blocks[0], ctx) : emitMultiBlock(fn, blocks, ctx);
	return E.FunDef(fn.name, params, body);
}

function emitSingleBlock(block: MIR.Block, ctx: Ctx): E.Expr {
	const tail = emitTerminator(block.terminator);
	return block.instrs.reduceRight<E.Expr>((body, instr) => emitInstr(instr, body, ctx), tail);
}

function emitMultiBlock(fn: MIR.Function, blocks: Map<string, MIR.Block>, ctx: Ctx): E.Expr {
	const defs = fn.blocks.map(block => {
		const params = block.params.map(v);
		const tail = emitTerminator(block.terminator);
		const body = block.instrs.reduceRight<E.Expr>((b, instr) => emitInstr(instr, b, ctx), tail);
		return E.FunDef(block.label, params, body);
	});

	const entryBlock = blocks.get(fn.entry)!;
	const entryCall = E.Apply(
		E.Var(`'${fn.entry}'/${entryBlock.params.length}`),
		entryBlock.params.map(p => E.Var(v(p))),
	);

	return E.Letrec(defs, entryCall);
}

function emitInstr(instr: MIR.Instr, body: E.Expr, ctx: Ctx): E.Expr {
	return match(instr)
		.with({ type: "Let" }, ({ name, expr }) => E.Let1(v(name), emitExpr(expr, ctx), body))
		.with({ type: "Read" }, ({ label, target, result }) => E.Let1(v(result), E.Call("maps", "get", [E.Lit(E.Atom(label)), E.Var(v(target))]), body))
		.with({ type: "Alloc" }, ({ alloc, result }) => {
			const pairs = E.List(alloc.fields.map(f => E.Tuple([E.Lit(E.Atom(f.label)), E.Var(v(f.value))])));
			return E.Let1(v(result), E.Call("maps", "from_list", [pairs]), body);
		})
		.with({ type: "Update", mode: "immutable" }, ({ into, result, alloc }) => {
			const updates = E.List(alloc.fields.map(f => E.Tuple([E.Lit(E.Atom(f.label)), E.Var(v(f.value))])));
			const merged = E.Call("maps", "merge", [E.Var(v(into)), E.Call("maps", "from_list", [updates])]);
			return E.Let1(v(result), merged, body);
		})
		.with({ type: "Update", mode: "fbip" }, ({ into, updates }) =>
			updates.reduceRight<E.Expr>((b, u, i) => {
				const prev = i === 0 ? v(into) : `${v(into)}_fbip_${i - 1}`;
				const tmpName = `${v(into)}_fbip_${i}`;
				return E.Let1(tmpName, E.Call("maps", "put", [E.Lit(E.Atom(u.label)), E.Var(v(u.value)), E.Var(prev)]), b);
			}, body),
		)
		.with({ type: "Call" }, ({ target, args, result }) =>
			match(target)
				.with({ type: "direct" }, ({ func }) =>
					E.Let1(
						v(result),
						E.Apply(
							E.Var(v(func)),
							args.map(a => E.Var(v(a))),
						),
						body,
					),
				)
				.with({ type: "indirect" }, ({ callee }) =>
					E.Let1(
						v(result),
						E.Apply(
							E.Var(v(callee)),
							args.map(a => E.Var(v(a))),
						),
						body,
					),
				)
				.exhaustive(),
		)
		.exhaustive();
}

function emitExpr(expr: MIR.Expr, ctx: Ctx): E.Expr {
	return match(expr)
		.with({ type: "Var" }, ({ name }) => E.Var(v(name)))
		.with({ type: "Lit" }, ({ value }) => emitLiteral(value))
		.with({ type: "FuncRef" }, ({ name }) => {
			const arity = ctx.arities.get(name);

			if (arity === undefined) {
				throw new Error(`emit_erl: unknown function arity for "${name}"`);
			}
			return E.Fun(MODULE_NAME, name, arity);
		})
		.with({ type: "PrimOp" }, ({ op, args }) => {
			const info = PRIMOP_ERL[op];

			if (!info) {
				throw new Error(`emit_erl: unknown primop "${op}"`);
			}
			return info.kind === "unary" ? E.Call(info.mod, info.fn, [E.Var(v(args[0]))]) : E.Call(info.mod, info.fn, [E.Var(v(args[0])), E.Var(v(args[1]))]);
		})
		.exhaustive();
}

function emitLiteral(lit: Literal): E.Expr {
	return match(lit)
		.with({ type: "Num" }, l => E.Lit(E.Int(l.value)))
		.with({ type: "Bool" }, l => E.Lit(E.Atom(l.value ? "true" : "false")))
		.with({ type: "String" }, l => E.Lit(E.Str(l.value)))
		.with({ type: "unit" }, () => E.Lit(E.Atom("nil")))
		.with({ type: "Atom" }, l => E.Lit(E.Atom(l.value)))
		.exhaustive();
}

function toStr(scrutinee: E.Expr): E.Expr {
	return E.Case(scrutinee, [
		E.Clause(E.PVar("_A"), E.Call("erlang", "is_atom", [E.Var("_A")]), E.Call("erlang", "atom_to_list", [E.Var("_A")])),
		E.Clause(E.PVar("_N"), E.Call("erlang", "is_integer", [E.Var("_N")]), E.Call("erlang", "integer_to_list", [E.Var("_N")])),
		E.Clause(E.PVar("_L"), E.TrueGuard, E.Var("_L")),
	]);
}

function emitTerminator(t: MIR.Terminator): E.Expr {
	return match(t)
		.with({ type: "Return" }, ({ value }) => E.Var(v(value)))
		.with({ type: "Jump" }, ({ target, args }) =>
			E.Apply(
				E.Var(`'${target}'/${args.length}`),
				args.map(a => E.Var(v(a))),
			),
		)
		.with({ type: "Branch" }, ({ scrutinee, cases, default: def }) => {
			const scrutStr = toStr(E.Var(v(scrutinee)));
			const clauses = cases.map(c =>
				E.Clause(
					E.PLit(E.Str(c.value)),
					E.TrueGuard,
					E.Apply(
						E.Var(`'${c.target}'/${c.args.length}`),
						c.args.map(a => E.Var(v(a))),
					),
				),
			);
			if (def) {
				clauses.push(
					E.Clause(
						E.PWild,
						E.TrueGuard,
						E.Apply(
							E.Var(`'${def.target}'/${def.args.length}`),
							def.args.map(a => E.Var(v(a))),
						),
					),
				);
			}
			return E.Case(scrutStr, clauses);
		})
		.exhaustive();
}
