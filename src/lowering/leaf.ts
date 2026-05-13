import type { Literal } from "@yap/shared/literals";
import * as MIR from "./mir";
import * as M from "./monad";
import { ARITIES } from "./shared/primops";

const { Instr, Expr: E } = MIR.Constructors;

export const literal = (value: Literal): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const x = ctx.nextVar();
		yield* M.Pending.append(Instr.Let(x.name, E.Lit(value)));
		yield* M.Results.push({ tag: "value", value: x });
	});

export const bound = (index: number): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.bound.get(index);
		if (stamped === undefined) {
			return yield* M.fail<void>({ tag: "UnboundBoundIndex", index });
		}
		yield* M.Results.push({ tag: "value", value: stamped });
	});

export const free = (name: string): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.free.get(name);
		if (stamped === undefined) {
			return yield* M.fail<void>({ tag: "UnboundFreeName", name });
		}
		yield* M.Results.push({ tag: "value", value: stamped });
	});

export const foreign = (name: string): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.free.get(name);
		if (stamped !== undefined) {
			return yield* M.Results.push({ tag: "value", value: stamped });
		}
		const primArity = ARITIES[name];
		if (primArity !== undefined) {
			return yield* M.Results.push({ tag: "primop", op: name, arity: primArity, args: [] });
		}
		const decl = ctx.declarations.get(name);
		if (decl !== undefined) {
			return yield* M.Results.push({ tag: "foreign", name, arity: decl.arity, args: [] });
		}
		return yield* M.fail<void>({ tag: "UnboundForeignName", name });
	});

export const erase = (): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const result = ctx.nextVar();
		yield* M.Pending.append(Instr.Alloc({ type: "Record", fields: [] }, result.name));
		yield* M.Results.push({ tag: "value", value: result });
	});
