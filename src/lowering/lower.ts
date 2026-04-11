import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import { match } from "ts-pattern";
import * as MIR from "./mir";
import { Patterns } from "./patterns";
import type { Frame, LowerCtx, LowerResult, ResumeBlockInfo } from "./context";
import { at, bind, mkCtx, resolveCaptured } from "./context";
import { convertClosure } from "./closures";
import { lowerMatch, lowerMatchFromScrut } from "./match";
import { freeVars, sortedNumbers } from "./shared/freevars";
import type { ResetCtx } from "./delimited_continuation/types";

/**
 * Global worklist and result stack for stack-based lowering (no recursion).
 * Same pattern as evaluation.v2.ts globalWorkStack + globalResultStack.
 */
const worklist: Frame[] = [];
const resultStack: LowerResult[] = [];

const worklistPush = (frame: Frame): void => {
	worklist.push(frame);
};

const worklistPop = (): Frame | undefined => worklist.pop();

const resultStackPush = (r: LowerResult): void => {
	resultStack.push(r);
};

const resultStackPop = (arity: number): LowerResult[] => {
	const len = resultStack.length;
	if (len < arity) {
		throw new Error(`Result stack underflow: need ${arity}, have ${len}`);
	}
	return resultStack.splice(-arity, arity);
};

function lowerBlockRecursive(stmts: EB.Statement[], returnTerm: EB.Term, ctx: LowerCtx): LowerResult {
	if (stmts.length === 0) {
		return lowerRecursive(returnTerm, ctx);
	}

	const [current, ...rest] = stmts;

	return match(current)
		.with({ type: "Let" }, ({ variable, value }) => {
			const valueResult = lowerRecursive(value, ctx);
			const extended = bind(ctx, variable, new Map([[0, valueResult.value]]));
			const restResult = lowerBlockRecursive(rest, returnTerm, extended);
			return {
				instrs: [...valueResult.instrs, ...restResult.instrs],
				value: restResult.value,
				functions: [...valueResult.functions, ...restResult.functions],
			};
		})
		.with({ type: "Expression" }, ({ value }) => {
			const exprResult = lowerRecursive(value, ctx);
			const restResult = lowerBlockRecursive(rest, returnTerm, ctx);
			return {
				instrs: [...exprResult.instrs, ...restResult.instrs],
				value: restResult.value,
				functions: [...exprResult.functions, ...restResult.functions],
			};
		})
		.with({ type: "Using" }, () => {
			throw new Error("Block lowering: Using statement not implemented");
		})
		.exhaustive();
}

/** Push frames for block statements. Like evaluation.v2 processStatementsAndPush. */
function processStatementsAndPush(stmts: EB.Statement[], ctx: LowerCtx, returnTerm: EB.Term): void {
	if (stmts.length === 0) {
		worklistPush({ type: "Lower", ctx, term: returnTerm });
		return;
	}

	const [current, ...rest] = stmts;

	match(current)
		.with({ type: "Let" }, ({ variable, value }) => {
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([valueResult]) => {
					const extended = bind(ctx, variable, new Map([[0, valueResult.value]]));
					worklistPush({
						type: "Cont",
						arity: 1,
						handler: ([restResult]) => {
							resultStackPush({
								instrs: [...valueResult.instrs, ...restResult.instrs],
								value: restResult.value,
								functions: [...valueResult.functions, ...restResult.functions],
							});
						},
					});
					processStatementsAndPush(rest, extended, returnTerm);
				},
			});
			worklistPush({ type: "Lower", ctx, term: value });
		})
		.with({ type: "Expression" }, ({ value }) => {
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([exprResult]) => {
					worklistPush({
						type: "Cont",
						arity: 1,
						handler: ([restResult]) => {
							resultStackPush({
								instrs: [...exprResult.instrs, ...restResult.instrs],
								value: restResult.value,
								functions: [...exprResult.functions, ...restResult.functions],
							});
						},
					});
					processStatementsAndPush(rest, ctx, returnTerm);
				},
			});
			worklistPush({ type: "Lower", ctx, term: value });
		})
		.with({ type: "Using" }, () => {
			throw new Error("Block lowering: Using statement not implemented");
		})
		.exhaustive();
}

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

/** Recursive lowering used by lowerMatch and other sync callers. */
function lowerRecursive(term: EB.Term, ctx: LowerCtx): LowerResult {
	const prim = unwrapPrimitiveApp(term);
	if (prim && prim.args.length > 0) {
		const results = prim.args.map(arg => lowerRecursive(arg, ctx));
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
			const target = lowerRecursive(t, ctx);
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
			const intoResult = lowerRecursive(t, ctx);
			const valueResult = lowerRecursive(val, ctx);
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
			const fieldResults = fields.map(({ label, term: t }) => ({ label, value: lowerRecursive(t, ctx) }));
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
			const funcResult = lowerRecursive(func, ctx);
			const argResult = lowerRecursive(arg, ctx);
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
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => lowerMatch(scrutinee, alternatives, ctx, lowerRecursive))
		.with(Patterns.Block, ({ statements, return: ret }) => lowerBlockRecursive(statements, ret, ctx))
		.with(Patterns.Reset, ({ term }) => {
			const resetCtx: ResetCtx = { resetExit: ctx.nextLabel(), continuations: new Map() };
			return lowerRecursive(term, { ...ctx, resetCtx });
		})
		.with(Patterns.Shift, () => {
			throw new Error("Shift must be lowered via worklist (lowerToMir); use lowerToMir for shift/reset terms");
		})
		.with(Patterns.Lambda, ({ binding, body }) => {
			const freeIndices = sortedNumbers(freeVars(body, 1));
			const captured = resolveCaptured(ctx, freeIndices);

			const readVars = freeIndices.map(() => ctx.nextVar());
			const overrides = new Map(freeIndices.map((idx, j) => [idx, at(readVars, j)]));
			const inner = lowerRecursive(body, bind(ctx, binding.variable, overrides));

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

/** Synchronous lowering (for tests and lowerMatch). Use lowerToMir for full pipeline. */
export const lower = lowerRecursive;

/** Worklist dispatch: leaf terms push result; compound terms push Cont + Lower frames. */
function lowerTerm(ctx: LowerCtx, term: EB.Term): void {
	const prim = unwrapPrimitiveApp(term);
	if (prim && prim.args.length > 0) {
		const n = prim.args.length;
		const sbc = ctx.shiftBodyCtx;
		const resetExit = ctx.resetCtx?.resetExit;
		worklistPush({
			type: "Cont",
			arity: n,
			handler: results => {
				const withTerminator = results.filter(
					(r): r is typeof r & { terminator: NonNullable<typeof r.terminator>; kCallIndex: number } => r.terminator != null && r.kCallIndex != null,
				);
				if (withTerminator.length > 0 && sbc && resetExit) {
					// Multishot: fill resume blocks, push first k-call result (don't combine)
					withTerminator.sort((a, b) => a.kCallIndex - b.kCallIndex);
					for (let i = 0; i < withTerminator.length; i++) {
						const r = withTerminator[i]!;
						const rb = sbc.resumeBlocks.find(rb => rb.index === r.kCallIndex);

						if (!rb) {
							continue;
						}
						rb.body = (valueParam, envParam) => {
							const envUpdated = ctx.nextVar("env");
							const updateInstr = MIR.Constructors.Instr.UpdateImmutable(envParam, envUpdated, {
								type: "Record",
								fields: [{ label: `r${r.kCallIndex}`, value: valueParam }],
							});
							if (i < withTerminator.length - 1) {
								const next = withTerminator[i + 1]!;
								const filtered = next.instrs.filter((instr): instr is typeof instr => !(instr.type === "Read" && instr.label === "__env"));
								const jumpArgs = next.terminator!.type === "Jump" ? next.terminator.args : [];
								return {
									instrs: [updateInstr, ...filtered],
									terminator: MIR.Constructors.Terminator.Jump(sbc.contBlock, [next.value, envUpdated, jumpArgs[2] ?? ""]),
								};
							}
							const readVars = results.map((_, j) => ctx.nextVar());
							const readInstrs = results.map((_, j) => MIR.Constructors.Instr.Read(`r${j}`, envUpdated, readVars[j]!));
							const addResult = ctx.nextVar();
							return {
								instrs: [updateInstr, ...readInstrs, MIR.Constructors.Instr.Let(addResult, MIR.Constructors.Expr.PrimOp(prim.op, readVars))],
								terminator: MIR.Constructors.Terminator.Jump(resetExit, [addResult]),
							};
						};
					}
					resultStackPush(withTerminator[0]!);
					return;
				}
				const instrs = results.flatMap(r => r.instrs);
				const argVars = results.map(r => r.value);
				const functions = results.flatMap(r => r.functions);
				const result = ctx.nextVar();
				resultStackPush({
					instrs: [...instrs, MIR.Constructors.Instr.Let(result, MIR.Constructors.Expr.PrimOp(prim.op, argVars))],
					value: result,
					functions,
				});
			},
		});
		for (let i = n - 1; i >= 0; i--) {
			worklistPush({ type: "Lower", ctx, term: prim.args[i]! });
		}
		return;
	}

	match(term)
		.with({ type: "Proj", term: Patterns.Row }, ({ term: t }) => resultStackPush(eraseTypeLevel(t, ctx)))
		.with({ type: "Proj", term: Patterns.TypeLevelApp }, ({ term: t }) => resultStackPush(eraseTypeLevel(t, ctx)))
		.with(Patterns.Proj, ({ label, term: t }) => {
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([target]) => {
					const result = ctx.nextVar();
					resultStackPush({
						instrs: [...target.instrs, MIR.Constructors.Instr.Read(label, target.value, result)],
						value: result,
						functions: target.functions,
					});
				},
			});
			worklistPush({ type: "Lower", ctx, term: t });
		})
		.with({ type: "Inj", term: Patterns.Row }, ({ term: t }) => resultStackPush(eraseTypeLevel(t, ctx)))
		.with({ type: "Inj", term: Patterns.TypeLevelApp }, ({ term: t }) => resultStackPush(eraseTypeLevel(t, ctx)))
		.with(Patterns.Inj, ({ label, value: val, term: t }) => {
			worklistPush({
				type: "Cont",
				arity: 2,
				handler: ([intoResult, valueResult]) => {
					const result = ctx.nextVar();
					const alloc: MIR.Allocation = { type: "Record", fields: [{ label, value: valueResult.value }] };
					resultStackPush({
						instrs: [...intoResult.instrs, ...valueResult.instrs, MIR.Constructors.Instr.UpdateImmutable(intoResult.value, result, alloc)],
						value: result,
						functions: [...intoResult.functions, ...valueResult.functions],
					});
				},
			});
			worklistPush({ type: "Lower", ctx, term: val });
			worklistPush({ type: "Lower", ctx, term: t });
		})
		.with(Patterns.StructApp, ({ arg }) => {
			const row = arg.row;
			const fields = extractFields(row);
			worklistPush({
				type: "Cont",
				arity: fields.length,
				handler: fieldResults => {
					const result = ctx.nextVar();
					const instrs = fieldResults.flatMap(r => r.instrs);
					const functions = fieldResults.flatMap(r => r.functions);
					const alloc: MIR.Allocation = {
						type: "Record",
						fields: fieldResults.map((r, i) => ({ label: fields[i]!.label, value: r.value })),
					};
					instrs.push(MIR.Constructors.Instr.Alloc(alloc, result));
					resultStackPush({ instrs, value: result, functions });
				},
			});
			for (let i = fields.length - 1; i >= 0; i--) {
				worklistPush({ type: "Lower", ctx, term: fields[i]!.term });
			}
		})
		.with(Patterns.App, ({ func, arg }) => {
			const sbc = ctx.shiftBodyCtx;
			const isKCall = sbc && func.type === "Var" && func.variable.type === "Bound" && func.variable.index === 0 && ctx.bound.get(0) === sbc.kRef;

			if (isKCall) {
				const idx = sbc!.resumeIndex++;
				sbc!.resumeBlocks.push({ label: ctx.nextLabel(), index: idx });
				const indexVar = ctx.nextVar("i");
				worklistPush({
					type: "Cont",
					arity: 1,
					handler: ([argResult]) => {
						const instrs = [
							...argResult.instrs,
							MIR.Constructors.Instr.Let(indexVar, MIR.Constructors.Expr.Lit(Lit.Num(idx))),
							MIR.Constructors.Instr.Read("__env", sbc!.kRef, sbc!.envRef),
						];
						resultStackPush({
							instrs,
							value: argResult.value,
							functions: argResult.functions,
							terminator: MIR.Constructors.Terminator.Jump(sbc!.contBlock, [argResult.value, sbc!.envRef, indexVar]),
							kCallIndex: idx,
						});
					},
				});
				worklistPush({ type: "Lower", ctx, term: arg });
				return;
			}

			worklistPush({
				type: "Cont",
				arity: 2,
				handler: ([funcResult, argResult]) => {
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
					resultStackPush({
						instrs,
						value: result,
						functions: [...funcResult.functions, ...argResult.functions],
					});
				},
			});
			worklistPush({ type: "Lower", ctx, term: arg });
			worklistPush({ type: "Lower", ctx, term: func });
		})
		.with(Patterns.Row, t => resultStackPush(eraseTypeLevel(t, ctx)))
		.with(Patterns.TypeLevelApp, t => resultStackPush(eraseTypeLevel(t, ctx)))
		.with(Patterns.Lit, ({ value }) => {
			const x = ctx.nextVar();
			resultStackPush({
				instrs: [MIR.Constructors.Instr.Let(x, MIR.Constructors.Expr.Lit(value))],
				value: x,
				functions: [],
			});
		})
		.with(Patterns.Vars.Bound, ({ variable }) => {
			const name = ctx.bound.get(variable.index);
			if (name === undefined) {
				throw new Error(`Unbound variable index ${variable.index}`);
			}
			resultStackPush({ instrs: [], value: name, functions: [] });
		})
		.with(Patterns.Vars.Free, ({ variable }) => {
			const name = ctx.free.get(variable.name);
			if (name !== undefined) {
				resultStackPush({ instrs: [], value: name, functions: [] });
				return;
			}
			throw new Error(`Unbound variable: ${variable.name}`);
		})
		.with(Patterns.Vars.Foreign, ({ variable }) => {
			const name = ctx.free.get(variable.name);
			if (name !== undefined) {
				resultStackPush({ instrs: [], value: name, functions: [] });
				return;
			}
			if (isPrimOp(variable.name)) {
				throw new Error(`Primitive ${variable.name} used as value; expected application (not yet implemented)`);
			}
			throw new Error(`Unbound variable: ${variable.name}`);
		})
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([scrutResult]) => {
					resultStackPush(lowerMatchFromScrut(scrutResult, alternatives, ctx, lowerRecursive));
				},
			});
			worklistPush({ type: "Lower", ctx, term: scrutinee });
		})
		.with(Patterns.Block, ({ statements, return: ret }) => {
			processStatementsAndPush(statements, ctx, ret);
		})
		.with(Patterns.Reset, ({ term }) => {
			const resetCtx: ResetCtx = { resetExit: ctx.nextLabel(), continuations: new Map() };
			const innerCtx = { ...ctx, resetCtx };
			worklistPush({ type: "Delimiter", id: 0, resultSize: resultStack.length });
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([result]) => resultStackPush(result),
			});
			worklistPush({ type: "Lower", ctx: innerCtx, term });
		})
		.with(Patterns.Shift, ({ body }) => {
			const rc = ctx.resetCtx;

			if (!rc) {
				throw new Error("Shift without enclosing reset");
			}

			const delimiterIndex = worklist.findLastIndex((f): f is Extract<Frame, { type: "Delimiter" }> => f.type === "Delimiter");

			if (delimiterIndex < 0) {
				throw new Error("Shift without enclosing reset");
			}

			const delimiter = worklist[delimiterIndex] as Extract<Frame, { type: "Delimiter" }>;
			worklist.splice(delimiterIndex);
			resultStack.splice(delimiter.resultSize);

			const resetExit = rc.resetExit;
			const shiftBodyLabel = ctx.nextLabel();
			const contLabel = ctx.nextLabel();
			const envRef = ctx.nextVar("env");
			const kRef = ctx.nextVar("k");

			const matchBody = (b: EB.Term): { k: string; inner: EB.Term } => {
				if (b.type === "Abs" && b.binding.type === "Lambda") {
					return { k: b.binding.variable, inner: b.body };
				}
				throw new Error("Shift body must be Lambda(k, e)");
			};
			const { k, inner } = matchBody(body);

			const shiftBodyCtx = { contBlock: contLabel, envRef, kRef, resumeIndex: 0, resumeBlocks: [] };
			const innerCtx = { ...bind(ctx, k, new Map([[0, kRef]])), shiftBodyCtx };

			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([bodyResult]) => {
					const sbc = innerCtx.shiftBodyCtx!;
					const exitParam = ctx.nextVar();
					const resetExitBlock = MIR.Constructors.Block(resetExit, [exitParam], [], MIR.Constructors.Terminator.Return(exitParam));
					const contParam = ctx.nextVar();
					const contEnvParam = ctx.nextVar("env");
					const contIndexParam = ctx.nextVar("i");
					const resumeBlocksInfo = sbc.resumeBlocks as ResumeBlockInfo[];
					const contTerminator =
						resumeBlocksInfo.length > 0
							? MIR.Constructors.Terminator.Branch(
									contIndexParam,
									resumeBlocksInfo.map((rb, i) => ({
										value: String(i),
										target: rb.label,
										args: [contParam, contEnvParam],
									})),
								)
							: MIR.Constructors.Terminator.Jump(resetExit, [contParam]);
					const contParams = resumeBlocksInfo.length > 0 ? [contParam, contEnvParam, contIndexParam] : [contParam, contEnvParam];
					const contBlock = MIR.Constructors.Block(contLabel, contParams, [], contTerminator);
					const resumeBlocks = resumeBlocksInfo.map((rb: ResumeBlockInfo) => {
						const valueParam = ctx.nextVar();
						const envParam = ctx.nextVar("env");
						const { instrs, terminator } = rb.body
							? rb.body(valueParam, envParam)
							: { instrs: [] as MIR.Instr[], terminator: MIR.Constructors.Terminator.Jump(resetExit, [valueParam]) };
						return MIR.Constructors.Block(rb.label, [valueParam, envParam], instrs, terminator);
					});
					const shiftBodyBlock = MIR.Constructors.Block(
						shiftBodyLabel,
						[kRef],
						bodyResult.instrs,
						bodyResult.terminator ?? MIR.Constructors.Terminator.Jump(resetExit, [bodyResult.value]),
					);
					const entryBlock = MIR.Constructors.Block(
						"entry",
						[],
						[
							MIR.Constructors.Instr.Alloc({ type: "Record", fields: [] }, envRef),
							MIR.Constructors.Instr.Alloc({ type: "Record", fields: [{ label: "__env", value: envRef }] }, kRef),
						],
						MIR.Constructors.Terminator.Jump(shiftBodyLabel, [kRef]),
					);
					resultStackPush({
						instrs: [],
						value: "",
						functions: bodyResult.functions,
						blocks: [entryBlock, resetExitBlock, contBlock, ...resumeBlocks, shiftBodyBlock, ...(bodyResult.blocks ?? [])],
						entry: "entry",
					});
				},
			});
			worklistPush({ type: "Lower", ctx: innerCtx, term: inner });
		})
		.with(Patterns.Lambda, ({ binding, body }) => {
			const freeIndices = sortedNumbers(freeVars(body, 1));
			const captured = resolveCaptured(ctx, freeIndices);
			const readVars = freeIndices.map(() => ctx.nextVar());
			const overrides = new Map(freeIndices.map((idx, j) => [idx, at(readVars, j)]));
			const innerCtx = bind(ctx, binding.variable, overrides);
			worklistPush({
				type: "Cont",
				arity: 1,
				handler: ([inner]) => {
					const fnName = ctx.nextVar("fn");
					const envFields = freeIndices.map((_, j) => ({ label: `v${j}`, value: at(captured, j) }));
					const envRef = ctx.nextVar("env");
					const envAllocInstrs: MIR.Instr[] = [MIR.Constructors.Instr.Alloc({ type: "Record", fields: envFields }, envRef)];
					const envParam = ctx.nextVar("env");
					const params = [envParam, binding.variable];
					const envReads = freeIndices.map((_, j) => MIR.Constructors.Instr.Read(`v${j}`, envParam, at(readVars, j)));
					const instrs = [...envReads, ...inner.instrs];
					resultStackPush(convertClosure(ctx, fnName, params, instrs, inner, envAllocInstrs, envRef));
				},
			});
			worklistPush({ type: "Lower", ctx: innerCtx, term: body });
		})
		.otherwise(() => {
			throw new Error(`Lowering not implemented for ${term.type} (primitives and ops only)`);
		});
}

export function lowerToMir(term: EB.Term): MIR.Module {
	worklist.length = 0;
	resultStack.length = 0;
	worklistPush({ type: "Lower", ctx: mkCtx(), term });

	while (true) {
		const frame = worklistPop();

		if (!frame) {
			break;
		}

		if (frame.type === "Cont") {
			const results = resultStackPop(frame.arity);
			frame.handler(results);
			continue;
		}

		if (frame.type === "Delimiter") {
			continue;
		}

		lowerTerm(frame.ctx, frame.term);
	}

	const resultCount = resultStack.length;
	if (resultCount !== 1) {
		throw new Error(`Expected exactly 1 result, got ${resultCount}`);
	}
	const result = resultStack.pop()!;
	if (result.blocks !== undefined && result.entry !== undefined) {
		const main = MIR.Constructors.Function("main", [], result.entry, result.blocks);
		return MIR.Constructors.Module([main, ...result.functions]);
	}
	const block = MIR.Constructors.Block("entry", [], result.instrs, MIR.Constructors.Terminator.Return(result.value));
	const main = MIR.Constructors.Function("main", [], "entry", [block]);
	return MIR.Constructors.Module([main, ...result.functions]);
}
