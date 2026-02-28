import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "../mir";
import { Patterns } from "../patterns";
import type { LowerCtx, LowerResult } from "../context";
import type { ContinuationInfo } from "./types";
import { freeVars, sortedNumbers } from "../shared/freevars";
import { resolveCaptured, bind } from "../context";

const ENV_FIELD = "__env";

/** Allocate continuation: env record + k_ref with __env. Returns instrs and kRef. */
export const allocContinuation = (ctx: LowerCtx, captured: string[]): { envRef: string; kRef: string; instrs: MIR.Instr[] } => {
	const envFields = captured.map((v, j) => ({ label: `v${j}`, value: v }));
	const envRef = ctx.nextVar("env");
	const envAlloc = MIR.Constructors.Instr.Alloc({ type: "Record", fields: envFields }, envRef);
	const kRef = ctx.nextVar("cont");
	const kAlloc = MIR.Constructors.Instr.Alloc({ type: "Record", fields: [{ label: ENV_FIELD, value: envRef }] }, kRef);
	return {
		envRef,
		kRef,
		instrs: [envAlloc, kAlloc],
	};
};

/** Emit Read(__env) + Jump for continuation resume. */
export const emitResume = (kRef: string, v: string, contInfo: ContinuationInfo, ctx: LowerCtx): { instrs: MIR.Instr[]; terminator: MIR.Terminator } => {
	const envRef = ctx.nextVar("env");
	const read = MIR.Constructors.Instr.Read(ENV_FIELD, kRef, envRef);
	const jump = MIR.Constructors.Terminator.Jump(contInfo.blockLabel, [v, envRef]);
	return { instrs: [read], terminator: jump };
};

/** True if term is App(k, v) where k is a continuation binder. */
export const isContinuationApp = (term: EB.Term, ctx: LowerCtx): boolean => {
	if (term.type !== "App") {
		return false;
	}
	const { func } = term;

	if (func.type !== "Var" || func.variable.type !== "Bound") {
		return false;
	}
	const resetCtx = ctx.resetCtx;

	if (!resetCtx) {
		return false;
	}
	return resetCtx.continuations.has(func.variable.index);
};

/**
 * Lower App(k, v) when k is continuation. Call only when isContinuationApp returned true.
 */
export const lowerContinuationApp = (term: EB.Term, ctx: LowerCtx, lower: (t: EB.Term, c: LowerCtx) => LowerResult): LowerResult => {
	if (term.type !== "App") {
		throw new Error("Expected App");
	}
	const { func, arg } = term;

	if (func.type !== "Var" || func.variable.type !== "Bound") {
		throw new Error("Expected continuation App");
	}
	const resetCtx = ctx.resetCtx!;
	const contInfo = resetCtx.continuations.get(func.variable.index);

	if (!contInfo) {
		throw new Error("Continuation not in resetCtx");
	}
	const kRef = ctx.bound.get(func.variable.index);

	if (!kRef) {
		throw new Error("Unbound continuation variable");
	}

	const argResult = lower(arg, ctx);
	const { instrs, terminator } = emitResume(kRef, argResult.value, contInfo, ctx);
	return {
		instrs: [...argResult.instrs, ...instrs],
		value: "",
		functions: argResult.functions,
		terminator,
	};
};

/**
 * Lower shift body (Lambda(k, e)) with restOfReset as continuation.
 * preInstrs: instrs from lowering the reset body before the shift.
 * restOfReset: null when continuation is empty (e.g. reset(shift body)).
 * hasResumptionBinder: true when shift is in Let RHS (e.g. let v = shift ...); continuation body has v at index 0.
 * Called from reset.ts lowerInReset.
 */
export const lowerShift = (
	preInstrs: MIR.Instr[],
	body: EB.Term,
	restOfReset: EB.Term | null,
	ctx: LowerCtx,
	lower: (t: EB.Term, c: LowerCtx) => LowerResult,
	hasResumptionBinder = false,
): LowerResult => {
	const lambda = match(body)
		.with(Patterns.Lambda, x => x)
		.otherwise(() => {
			throw new Error("Shift body must be Lambda(k, e)");
		});

	const freeIndices = restOfReset ? sortedNumbers(freeVars(restOfReset, 0)) : [];
	const envBlockIndices = hasResumptionBinder ? freeIndices.filter(i => i > 0).map(i => i - 1) : freeIndices;
	const captured = envBlockIndices.length > 0 ? resolveCaptured(ctx, envBlockIndices, 0) : [];

	const L_cont = ctx.nextLabel();
	const contInfo: ContinuationInfo = { blockLabel: L_cont };

	const { kRef, instrs: allocInstrs } = allocContinuation(ctx, captured);

	const continuations = new Map(ctx.resetCtx?.continuations ?? []);
	continuations.set(0, contInfo);
	const shiftCtx: LowerCtx = {
		...bind(ctx, kRef),
		resetCtx: {
			resetExit: ctx.resetCtx!.resetExit,
			continuations,
		},
	};

	const bodyResult = lower(lambda.body, shiftCtx);

	const shiftBodyLabel = ctx.nextLabel();
	const shiftBodyTerminator = bodyResult.terminator ?? MIR.Constructors.Terminator.Jump(ctx.resetCtx!.resetExit, [bodyResult.value]);
	const shiftBodyBlock = MIR.Constructors.Block(shiftBodyLabel, [kRef], bodyResult.instrs, shiftBodyTerminator);

	let contBlock: MIR.Block;
	let contValue: string;
	if (restOfReset === null) {
		const vParam = ctx.nextVar("v");
		const envParam = ctx.nextVar("env");
		contBlock = MIR.Constructors.Block(L_cont, [vParam, envParam], [], MIR.Constructors.Terminator.Jump(ctx.resetCtx!.resetExit, [vParam]));
		contValue = vParam;
	} else {
		const vParam = ctx.nextVar("v");
		const envParam = ctx.nextVar("env");
		const readVars = envBlockIndices.map(() => ctx.nextVar());
		const envReads = envBlockIndices.map((_, j) => MIR.Constructors.Instr.Read(`v${j}`, envParam, readVars[j]));
		const overrides = new Map<number, string>([
			...(hasResumptionBinder && freeIndices.includes(0) ? [[0, vParam] as const] : []),
			...(hasResumptionBinder
				? freeIndices.filter(i => i > 0).map((idx, j) => [idx, readVars[j]] as const)
				: freeIndices.map((idx, j) => [idx, readVars[j]] as const)),
		]);
		const contCtx: LowerCtx = {
			...ctx,
			bound: new Map([...ctx.bound, ...overrides]),
		};
		const contBodyResult = lower(restOfReset, contCtx);
		const contTerminator = contBodyResult.terminator ?? MIR.Constructors.Terminator.Jump(ctx.resetCtx!.resetExit, [contBodyResult.value]);
		contBlock = MIR.Constructors.Block(L_cont, [vParam, envParam], [...envReads, ...contBodyResult.instrs], contTerminator);
		contValue = contBodyResult.value;
	}

	const entryLabel = ctx.nextLabel();
	const entryBlock = MIR.Constructors.Block(entryLabel, [], [...preInstrs, ...allocInstrs], MIR.Constructors.Terminator.Jump(shiftBodyLabel, [kRef]));

	return {
		instrs: [],
		value: contValue,
		functions: bodyResult.functions,
		blocks: [entryBlock, shiftBodyBlock, contBlock],
		entry: entryLabel,
	};
};
