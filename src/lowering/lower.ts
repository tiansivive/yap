import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "./mir";
import { Patterns } from "./patterns";
import type { LowerCtx, LowerResult } from "./context";
import { at, bind, mkCtx, resolveCaptured } from "./context";
import { convertClosure } from "./closures";
import { lowerMatch } from "./match";
import { freeVars, sortedNumbers } from "./shared/freevars";
import { lowerReset, lowerInReset, isContinuationApp, lowerContinuationApp } from "./delimited_continuation";

function eraseTypeLevel(term: EB.Term, ctx: LowerCtx): LowerResult {
	// TODO: handle erasure more systematically; erasure semantics TBD
	console.warn("Type expression being erased during lowering:", term.type);
	const result = ctx.nextVar();
	return {
		instrs: [MIR.Constructors.Instr.Alloc({ type: "Record", fields: [] }, result)],
		value: result,
		functions: [],
	};
}

function extractFields(row: EB.Row): Array<{ label: string; term: EB.Term }> {
	return match(row)
		.with(Patterns.Rows.Extension, ({ label, value, row: rest }) => [{ label, term: value }, ...extractFields(rest)])
		.with(Patterns.Rows.Variable, () => {
			// TODO: handle erasure more systematically; erasure semantics TBD
			console.warn("Type expression being erased during lowering: row variable");
			throw new Error("Row variable in value position — type-level only");
		})
		.with(Patterns.Rows.Empty, () => [])
		.exhaustive();
}

const PRIM_OPS = new Set(["$add", "$sub", "$mul", "$div", "$and", "$or", "$eq", "$neq", "$lt", "$gt", "$lte", "$gte", "$mod", "$concat", "$not"]);

const isPrimOp = (name: string): boolean => PRIM_OPS.has(name);

function unwrapPrimitiveApp(term: EB.Term): { op: string; args: EB.Term[] } | null {
	return match(term)
		.with(Patterns.App, ({ func, arg }) => {
			const inner = unwrapPrimitiveApp(func);
			return inner ? { op: inner.op, args: [...inner.args, arg] } : null;
		})
		.with(Patterns.Vars.Foreign, ({ variable }) => (isPrimOp(variable.name) ? { op: variable.name, args: [] } : null))
		.otherwise(() => null);
}

export function lower(term: EB.Term, ctx: LowerCtx): LowerResult {
	const prim = unwrapPrimitiveApp(term);
	if (prim && prim.args.length > 0) {
		const results = prim.args.map(arg => lower(arg, ctx));
		const instrs = results.flatMap(r => r.instrs);
		const argVars = results.map(r => r.value);
		const functions = results.flatMap(r => r.functions);
		const result = ctx.nextVar();
		return {
			instrs: [...instrs, MIR.Constructors.Instr.Let(result, MIR.Constructors.Expr.PrimOp(prim.op, argVars))],
			value: result,
			functions,
		};
	}

	return match(term)
		.with({ type: "Proj", term: Patterns.Row }, ({ term: t }) => eraseTypeLevel(t, ctx))
		.with({ type: "Proj", term: Patterns.TypeLevelApp }, ({ term: t }) => eraseTypeLevel(t, ctx))
		.with(Patterns.Proj, ({ label, term: t }) => {
			const target = lower(t, ctx);
			const result = ctx.nextVar();
			return {
				instrs: [...target.instrs, MIR.Constructors.Instr.Read(label, target.value, result)],
				value: result,
				functions: target.functions,
			};
		})
		.with({ type: "Inj", term: Patterns.Row }, ({ term: t }) => eraseTypeLevel(t, ctx))
		.with({ type: "Inj", term: Patterns.TypeLevelApp }, ({ term: t }) => eraseTypeLevel(t, ctx))
		.with(Patterns.Inj, ({ label, value: val, term: t }) => {
			const intoResult = lower(t, ctx);
			const valueResult = lower(val, ctx);
			const result = ctx.nextVar();
			const alloc: MIR.Allocation = { type: "Record", fields: [{ label, value: valueResult.value }] };
			return {
				instrs: [...intoResult.instrs, ...valueResult.instrs, MIR.Constructors.Instr.UpdateImmutable(intoResult.value, result, alloc)],
				value: result,
				functions: [...intoResult.functions, ...valueResult.functions],
			};
		})
		.with(Patterns.StructApp, ({ arg }) => {
			const row = arg.row;
			const fields = extractFields(row);
			const fieldResults = fields.map(({ label, term: t }) => ({ label, value: lower(t, ctx) }));
			const result = ctx.nextVar();
			const instrs = fieldResults.flatMap(r => r.value.instrs);
			const functions = fieldResults.flatMap(r => r.value.functions);
			const alloc: MIR.Allocation = {
				type: "Record",
				fields: fieldResults.map(r => ({ label: r.label, value: r.value.value })),
			};
			instrs.push(MIR.Constructors.Instr.Alloc(alloc, result));
			return { instrs, value: result, functions };
		})
		.with(Patterns.App, ({ func, arg }) => {
			if (isContinuationApp(term, ctx)) {
				return lowerContinuationApp(term, ctx, lower);
			}
			const funcResult = lower(func, ctx);
			const argResult = lower(arg, ctx);
			const fnVar = ctx.nextVar("fnref");
			const envVar = ctx.nextVar("env");
			const result = ctx.nextVar();
			const instrs = [
				...funcResult.instrs,
				...argResult.instrs,
				MIR.Constructors.Instr.Read("__fn", funcResult.value, fnVar),
				MIR.Constructors.Instr.Read("__env", funcResult.value, envVar),
				MIR.Constructors.Instr.Call({ type: "indirect", callee: fnVar }, [envVar, argResult.value], result),
			];
			return {
				instrs,
				value: result,
				functions: [...funcResult.functions, ...argResult.functions],
			};
		})
		.with(Patterns.Row, t => eraseTypeLevel(t, ctx))
		.with(Patterns.TypeLevelApp, t => eraseTypeLevel(t, ctx))
		.with(Patterns.Lit, ({ value }) => {
			const x = ctx.nextVar();
			return {
				instrs: [MIR.Constructors.Instr.Let(x, MIR.Constructors.Expr.Lit(value))],
				value: x,
				functions: [],
			};
		})
		.with(Patterns.Vars.Bound, ({ variable }) => {
			const name = ctx.bound.get(variable.index);

			if (name === undefined) {
				throw new Error(`Unbound variable index ${variable.index}`);
			}
			return { instrs: [], value: name, functions: [] };
		})
		.with(Patterns.Vars.Free, ({ variable }) => {
			const name = ctx.free.get(variable.name);

			if (name !== undefined) {
				return { instrs: [], value: name, functions: [] };
			}
			throw new Error(`Unbound variable: ${variable.name}`);
		})
		.with(Patterns.Vars.Foreign, ({ variable }) => {
			const name = ctx.free.get(variable.name);

			if (name !== undefined) {
				return { instrs: [], value: name, functions: [] };
			}
			if (isPrimOp(variable.name)) {
				throw new Error(`Primitive ${variable.name} used as value; expected application (not yet implemented)`);
			}
			throw new Error(`Unbound variable: ${variable.name}`);
		})
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => lowerMatch(scrutinee, alternatives, ctx, lower))
		.with({ type: "Reset" }, ({ term: t }) => lowerReset(t, ctx, lower))
		.with({ type: "Shift" }, t => {
			if (!ctx.resetCtx) {
				throw new Error("Shift without enclosing reset");
			}
			return lowerInReset(t, ctx, lower);
		})
		.with(Patterns.Lambda, ({ binding, body }) => {
			const freeIndices = sortedNumbers(freeVars(body, 1));
			const captured = resolveCaptured(ctx, freeIndices);

			const readVars = freeIndices.map(() => ctx.nextVar());
			const overrides = new Map(freeIndices.map((idx, j) => [idx, at(readVars, j)]));
			const inner = lower(body, bind(ctx, binding.variable, overrides));

			const fnName = ctx.nextVar("fn");
			const envFields = freeIndices.map((_, j) => ({ label: `v${j}`, value: at(captured, j) }));
			const envRef = ctx.nextVar("env");
			const envAllocInstrs: MIR.Instr[] = [MIR.Constructors.Instr.Alloc({ type: "Record", fields: envFields }, envRef)];

			// Uniform calling convention: caller always passes [env, arg]. Closed lambdas accept env but don't use it.
			const envParam = ctx.nextVar("env");
			const params = [envParam, binding.variable];
			const envReads = freeIndices.map((_, j) => MIR.Constructors.Instr.Read(`v${j}`, envParam, at(readVars, j)));
			const instrs = [...envReads, ...inner.instrs];
			return convertClosure(ctx, fnName, params, instrs, inner, envAllocInstrs, envRef);
		})
		.otherwise(() => {
			throw new Error(`Lowering not implemented for ${term.type} (primitives and ops only)`);
		});
}

export function lowerToMir(term: EB.Term): MIR.Module {
	const ctx = mkCtx();
	const result = lower(term, ctx);
	if (result.blocks !== undefined && result.entry !== undefined) {
		const main = MIR.Constructors.Function("main", [], result.entry, result.blocks);
		return MIR.Constructors.Module([main, ...result.functions]);
	}
	const block = MIR.Constructors.Block("entry", [], result.instrs, MIR.Constructors.Terminator.Return(result.value));
	const main = MIR.Constructors.Function("main", [], "entry", [block]);
	return MIR.Constructors.Module([main, ...result.functions]);
}
