import { match } from "ts-pattern";
import type { Module, Function, Block, Instr, Expr, Terminator, Label } from "./mir";
import type { Literal } from "@yap/shared/literals";

export type Value = null | number | boolean | string | { [k: string]: Value } | { __funcref: string };

type Env = Map<string, Value>;

type Ctx = {
	functions: Map<string, Function>;
	ffi: Record<string, (...args: any[]) => any>;
};

export function interpret(mod: Module, ffi?: Record<string, (...args: any[]) => any>): Value {
	const functions = new Map(mod.functions.map(f => [f.name, f] as const));
	const main = functions.get("main");

	if (!main) {
		throw new Error("interpret: no main function in module");
	}
	const ctx: Ctx = {
		functions,
		ffi: ffi ?? {},
	};
	return execFunction(main, [], ctx);
}

function execFunction(fn: Function, args: Value[], ctx: Ctx): Value {
	const blocks = new Map(fn.blocks.map(b => [b.label, b] as const));
	const env: Env = new Map();
	fn.params.forEach((p, i) => env.set(p, args[i]));

	let current = blocks.get(fn.entry)!;

	while (true) {
		for (const instr of current.instrs) {
			execInstr(env, instr, ctx);
		}

		const t = current.terminator;

		if (t.type === "Return") {
			return lookup(env, t.value);
		}

		if (t.type === "Jump") {
			const jump = resolveJump(blocks, env, t.target, t.args);
			enterBlock(env, jump);
			current = jump.block;
			continue;
		}

		// Branch
		const scrutinee = lookup(env, t.scrutinee);
		const matched = t.cases.find(c => c.value === String(scrutinee));
		const dest = matched ?? t.default;

		if (!dest) {
			throw new Error(`interpret: non-exhaustive branch on "${scrutinee}"`);
		}
		const jump = resolveJump(blocks, env, dest.target, dest.args);
		enterBlock(env, jump);
		current = jump.block;
	}
}

const execInstr = (env: Env, instr: Instr, ctx: Ctx): void => {
	match(instr)
		.with({ type: "Let" }, ({ name, expr }) => {
			env.set(name, evalExpr(env, expr));
		})
		.with({ type: "Read" }, ({ label, target, result }) => {
			const obj = lookup(env, target) as Record<string, Value>;
			env.set(result, obj[label]);
		})
		.with({ type: "Alloc" }, ({ alloc, result }) => {
			const obj: Record<string, Value> = {};

			for (const f of alloc.fields) {
				obj[f.label] = lookup(env, f.value);
			}
			env.set(result, obj);
		})
		.with({ type: "Update", mode: "immutable" }, ({ into, result, alloc }) => {
			const base = lookup(env, into) as Record<string, Value>;
			const obj = { ...base };

			for (const f of alloc.fields) {
				obj[f.label] = lookup(env, f.value);
			}
			env.set(result, obj);
		})
		.with({ type: "Update", mode: "fbip" }, ({ into, updates }) => {
			const obj = lookup(env, into) as Record<string, Value>;

			for (const u of updates) {
				obj[u.label] = lookup(env, u.value);
			}
		})
		.with({ type: "Call" }, ({ target, args, result }) => {
			const resolvedArgs = args.map(a => lookup(env, a));
			match(target)
				.with({ type: "direct" }, ({ func }) => {
					const fn = ctx.ffi[func];

					if (!fn) {
						throw new Error(`interpret: unknown FFI function "${func}"`);
					}
					env.set(result, fn(...resolvedArgs));
				})
				.with({ type: "indirect" }, ({ callee }) => {
					const ref = lookup(env, callee) as { __funcref: string };
					const fn = ctx.functions.get(ref.__funcref);

					if (!fn) {
						throw new Error(`interpret: unknown function "${ref.__funcref}"`);
					}
					env.set(result, execFunction(fn, resolvedArgs, ctx));
				})
				.exhaustive();
		})

		.exhaustive();
};

const evalExpr = (env: Env, expr: Expr): Value =>
	match(expr)
		.with({ type: "Var" }, ({ name }) => lookup(env, name))
		.with({ type: "Lit" }, ({ value }) => evalLiteral(value))
		.with({ type: "FuncRef" }, ({ name }) => ({ __funcref: name }) as Value)
		.with({ type: "PrimOp" }, ({ op, args }) => evalPrimOp(env, op, args))
		.exhaustive();

const lookup = (env: Env, name: string): Value => {
	const v = env.get(name);

	if (v === undefined) {
		throw new Error(`interpret: unbound variable "${name}"`);
	}
	return v;
};

const evalLiteral = (lit: Literal): Value =>
	match(lit)
		.with({ type: "Num" }, l => l.value)
		.with({ type: "Bool" }, l => l.value)
		.with({ type: "String" }, l => l.value)
		.with({ type: "unit" }, () => null)
		.with({ type: "Atom" }, l => l.value)
		.exhaustive();

const evalPrimOp = (env: Env, op: string, args: string[]): Value => {
	const vals = args.map(a => lookup(env, a));
	switch (op) {
		case "$add":
			return (vals[0] as number) + (vals[1] as number);
		case "$sub":
			return (vals[0] as number) - (vals[1] as number);
		case "$mul":
			return (vals[0] as number) * (vals[1] as number);
		case "$div":
			return (vals[0] as number) / (vals[1] as number);
		case "$mod":
			return (vals[0] as number) % (vals[1] as number);
		case "$and":
			return (vals[0] as boolean) && (vals[1] as boolean);
		case "$or":
			return (vals[0] as boolean) || (vals[1] as boolean);
		case "$not":
			return !(vals[0] as boolean);
		case "$eq":
			return vals[0] === vals[1];
		case "$neq":
			return vals[0] !== vals[1];
		case "$lt":
			return (vals[0] as number) < (vals[1] as number);
		case "$gt":
			return (vals[0] as number) > (vals[1] as number);
		case "$lte":
			return (vals[0] as number) <= (vals[1] as number);
		case "$gte":
			return (vals[0] as number) >= (vals[1] as number);
		case "$concat":
			return String(vals[0]) + String(vals[1]);
		default:
			throw new Error(`interpret: unknown primop "${op}"`);
	}
};

type JumpTarget = { block: Block; args: Value[] };

const resolveJump = (blocks: Map<Label, Block>, env: Env, target: Label, args: string[]): JumpTarget => {
	const block = blocks.get(target);

	if (!block) {
		throw new Error(`interpret: unknown block "${target}"`);
	}
	return { block, args: args.map(a => lookup(env, a)) };
};

const enterBlock = (env: Env, jump: JumpTarget): void => {
	jump.block.params.forEach((p, i) => env.set(p, jump.args[i]));
};
