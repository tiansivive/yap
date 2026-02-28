import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "../mir";
import type { LowerCtx, LowerResult } from "../context";
import { bind } from "../context";
import type { ResetCtx } from "./types";
import { lowerShift } from "./shift";

/** Find shift in block statements. Returns { preStmts, body, restOfReset, hasResumptionBinder } or null. */
const findShiftInBlock = (
	statements: EB.Statement[],
	returnTerm: EB.Term,
): { preStmts: EB.Statement[]; body: EB.Term; restOfReset: EB.Term; hasResumptionBinder: boolean } | null => {
	for (let i = 0; i < statements.length; i++) {
		const stmt = statements[i];
		if (stmt.type === "Expression" && stmt.value.type === "Shift") {
			const preStmts = statements.slice(0, i);
			const postStmts = statements.slice(i + 1);
			const restOfReset = postStmts.length > 0 ? EB.Constructors.Block(postStmts, returnTerm) : returnTerm;
			return {
				preStmts,
				body: stmt.value.body,
				restOfReset,
				hasResumptionBinder: false,
			};
		}
		if (stmt.type === "Let" && stmt.value.type === "Shift") {
			const preStmts = statements.slice(0, i);
			const postStmts = statements.slice(i + 1);
			const restOfReset = postStmts.length > 0 ? EB.Constructors.Block(postStmts, returnTerm) : returnTerm;
			return {
				preStmts,
				body: stmt.value.body,
				restOfReset,
				hasResumptionBinder: true,
			};
		}
	}
	return null;
};

/**
 * Lower term inside a reset. Traverses to find Shift; dispatches to lowerShift when found.
 * Phase 1: supports Shift at top level, or Block with one Shift.
 */
export const lowerInReset = (term: EB.Term, ctx: LowerCtx, lower: (t: EB.Term, c: LowerCtx) => LowerResult): LowerResult => {
	const resetCtx = ctx.resetCtx!;

	return match(term)
		.with({ type: "Shift" }, ({ body }) => {
			return lowerShift([], body, null, ctx, lower, false);
		})
		.with({ type: "Block" }, ({ statements, return: returnTerm }) => {
			const found = findShiftInBlock(statements, returnTerm);
			if (found) {
				let preInstrs: MIR.Instr[] = [];
				let runCtx = ctx;
				for (const stmt of found.preStmts) {
					if (stmt.type === "Expression") {
						const r = lower(stmt.value, runCtx);
						preInstrs = [...preInstrs, ...r.instrs];
						runCtx = bind(runCtx, r.value);
					} else if (stmt.type === "Let" || stmt.type === "Using") {
						const r = lower(stmt.value, runCtx);
						preInstrs = [...preInstrs, ...r.instrs];
						runCtx = bind(runCtx, r.value);
					}
				}
				return lowerShift(preInstrs, found.body, found.restOfReset, runCtx, lower, found.hasResumptionBinder);
			}
			let preInstrs: MIR.Instr[] = [];
			let runCtx = ctx;
			for (const stmt of statements) {
				if (stmt.type === "Expression") {
					const r = lower(stmt.value, runCtx);
					preInstrs = [...preInstrs, ...r.instrs];
					runCtx = bind(runCtx, r.value);
				} else if (stmt.type === "Let" || stmt.type === "Using") {
					const r = lower(stmt.value, runCtx);
					preInstrs = [...preInstrs, ...r.instrs];
					runCtx = bind(runCtx, r.value);
				}
			}
			const final = lower(returnTerm, runCtx);
			return { ...final, instrs: [...preInstrs, ...final.instrs] };
		})
		.otherwise(() => lower(term, ctx));
};

/**
 * Lower EB.Reset(term). Creates reset_entry, reset_exit blocks.
 */
export const lowerReset = (term: EB.Term, ctx: LowerCtx, lower: (t: EB.Term, c: LowerCtx) => LowerResult): LowerResult => {
	const resetExit = ctx.nextLabel();
	const mergeParam = ctx.nextVar();
	const resetCtx: ResetCtx = {
		resetExit,
		continuations: new Map(),
	};
	const innerCtx: LowerCtx = { ...ctx, resetCtx };

	const result = lowerInReset(term, innerCtx, lower);

	if (result.blocks !== undefined && result.entry !== undefined) {
		const mergeBlock = MIR.Constructors.Block(resetExit, [mergeParam], [], MIR.Constructors.Terminator.Return(mergeParam));
		return {
			instrs: [],
			value: mergeParam,
			functions: result.functions,
			blocks: [...result.blocks, mergeBlock],
			entry: result.entry,
		};
	}

	const entryBlock = MIR.Constructors.Block(ctx.nextLabel(), [], result.instrs, MIR.Constructors.Terminator.Jump(resetExit, [result.value]));
	const mergeBlock = MIR.Constructors.Block(resetExit, [mergeParam], [], MIR.Constructors.Terminator.Return(mergeParam));
	return {
		instrs: [],
		value: mergeParam,
		functions: result.functions,
		blocks: [entryBlock, mergeBlock],
		entry: entryBlock.label,
	};
};
