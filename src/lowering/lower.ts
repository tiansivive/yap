/**
 * Lowering v2 — worklist-driven, monad-hosted rewrite of the lowering pass.
 *
 * Substrate: the Glowering RWSE monad from `../monad.ts`. Every rule pushes a `Cont`
 * frame and one or more `Lower` frames; the top-level `drainAll` loop pops frames and
 * dispatches. No direct recursion: every subterm flows through the worklist, so when
 * Shift lands, suffix capture is uniform.
 *
 * Per-function CFG accumulation uses `M.Pending` with unique block labels:
 *   - main's entry pending block is labeled `"entry"`.
 *   - Each lambda's entry pending block is labeled `${fnName}_entry`.
 * Since labels are unique, all pending blocks coexist safely in `state.accumulated`.
 *
 * Main's entry block is finalized via `Pending.finalize` (which emits to the `Blocks`
 * Writer). Each lambda's body is captured by peeking its pending block in the harvest
 * Cont, after which `convertClosure` assembles the lifted Fn locally and emits it via
 * `M.Functions` (so it does NOT pass through the Blocks Writer).
 *
 * Match: Maranget clause matrix compiled via worklist-driven `compileSubMatrix`; each
 * alternative body is a `Lower` frame bracketed by `Cont`s that open/finalize its case block.
 */

import assert from "node:assert";
import * as EB from "@yap/elaboration";
import type { Literal } from "@yap/shared/literals";
import * as Lit from "@yap/shared/literals";
import { match } from "ts-pattern";
import * as R from "@yap/shared/rows";
import * as MIR from "./mir";
import * as M from "./monad";
import * as C from "./context";
import { Patterns } from "./patterns";
import { freeVars, sortedNumbers } from "./shared/freevars";
import { convertClosure } from "./closures";

const { Block, Instr, Expr: E, Terminator: T, Function: Fn, Module } = MIR.Constructors;

/* ================================================================================
 * Primops + helpers
 * ================================================================================ */

const PRIMOP_ARITIES: Record<string, number> = {
	$add: 2,
	$sub: 2,
	$mul: 2,
	$div: 2,
	$and: 2,
	$or: 2,
	$eq: 2,
	$neq: 2,
	$lt: 2,
	$gt: 2,
	$lte: 2,
	$gte: 2,
	$mod: 2,
	$concat: 2,
	$not: 1,
};

function extractFields(row: EB.Row): Array<{ label: string; term: EB.Term }> {
	return match(row)
		.with(Patterns.Rows.Extension, ({ label, value, row: rest }) => [{ label, term: value }, ...extractFields(rest)])
		.with(Patterns.Rows.Variable, () => {
			throw new Error("Row variable in value position — type-level only");
		})
		.with(Patterns.Rows.Empty, () => [])
		.exhaustive();
}

/* ================================================================================
 * Push helpers
 * ================================================================================ */

function* pushChildrenReversed(ctx: C.LowerCtx, terms: EB.Term[]): M.Glowering<void> {
	for (let i = terms.length - 1; i >= 0; i--) {
		const term = terms[i];
		assert(term);
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	}
}

const notImplemented = (what: string): M.Lowering<void> =>
	M.Do(function* () {
		return yield* M.fail<void>({ tag: "NotImplemented", what });
	});

/* ================================================================================
 * Leaf rules — push a result directly
 * ================================================================================ */

function lowerLit(value: Literal): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const x = ctx.nextVar();
		yield* M.Pending.append(Instr.Let(x.name, E.Lit(value)));
		yield* M.Results.push({ tag: "value", value: x });
	});
}

function lowerBound(index: number): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.bound.get(index);
		if (stamped === undefined) {
			return yield* M.fail<void>({ tag: "UnboundBoundIndex", index });
		}
		yield* M.Results.push({ tag: "value", value: stamped });
	});
}

function lowerFree(name: string): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.free.get(name);
		if (stamped === undefined) {
			return yield* M.fail<void>({ tag: "UnboundFreeName", name });
		}
		yield* M.Results.push({ tag: "value", value: stamped });
	});
}

function lowerForeign(name: string): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const stamped = ctx.free.get(name);
		if (stamped !== undefined) {
			yield* M.Results.push({ tag: "value", value: stamped });
			return;
		}
		const primArity = PRIMOP_ARITIES[name];
		if (primArity !== undefined) {
			yield* M.Results.push({ tag: "primop", op: name, arity: primArity, args: [] });
			return;
		}
		const decl = ctx.declarations.get(name);
		if (decl !== undefined) {
			yield* M.Results.push({ tag: "foreign", name, arity: decl.arity, args: [] });
			return;
		}
		return yield* M.fail<void>({ tag: "UnboundForeignName", name });
	});
}

function eraseTypeLevel(): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const result = ctx.nextVar();
		yield* M.Pending.append(Instr.Alloc({ type: "Record", fields: [] }, result.name));
		yield* M.Results.push({ tag: "value", value: result });
	});
}

/* ================================================================================
 * Compound rules — push Cont + Lower frames
 * ================================================================================ */

function lowerProj(label: string, term: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([target]) =>
				M.Do(function* () {
					assert(target);
					const result = ctx.nextVar();
					yield* M.Pending.append(Instr.Read(label, target.value.name, result.name));
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	});
}

function lowerInj(label: string, value: EB.Term, term: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		yield* M.Worklist.push({
			type: "Cont",
			arity: 2,
			handler: ([intoR, valueR]) =>
				M.Do(function* () {
					assert(intoR);
					assert(valueR);
					const result = ctx.nextVar();
					yield* M.Pending.append(
						Instr.UpdateImmutable(intoR.value.name, result.name, {
							type: "Record",
							fields: [{ label, value: valueR.value.name }],
						}),
					);
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		// LIFO: push `value` first so `term` (the "into") drains first.
		yield* M.Worklist.push({ type: "Lower", ctx, term: value });
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	});
}

function lowerStructApp(row: EB.Row): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const fields = extractFields(row);
		yield* M.Worklist.push({
			type: "Cont",
			arity: fields.length,
			handler: results =>
				M.Do(function* () {
					const result = ctx.nextVar();
					yield* M.Pending.append(
						Instr.Alloc({ type: "Record", fields: results.map((r, i) => ({ label: fields[i]?.label ?? "", value: r.value.name })) }, result.name),
					);
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		yield* pushChildrenReversed(
			ctx,
			fields.map(f => f.term),
		);
	});
}

function lowerApp(func: EB.Term, arg: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();

		// Inside a shift body, an App whose head is the bound continuation k is a k-call:
		// split the current block with a jump to r, open a fresh s_i block.
		const sbc = ctx.shiftBodyCtx;
		const isKCall = sbc !== undefined && func.type === "Var" && func.variable.type === "Bound" && ctx.bound.get(func.variable.index)?.stamp === sbc.kRef.stamp;
		if (isKCall) {
			assert(sbc);
			return yield* M.pure(lowerKCall(ctx, sbc, arg));
		}

		yield* M.Worklist.push({
			type: "Cont:sat",
			arity: 2,
			saturate: new Set([0]),
			handler: ([funcR, argR]) =>
				M.Do(function* () {
					assert(funcR);
					assert(argR);
					const argVal = (argR as M.ValueResult).value;
					yield match(funcR)
						.with({ tag: "foreign" as const }, fr => {
							const newArgs = [...fr.args, argVal];
							if (newArgs.length === fr.arity) {
								return M.Do(function* () {
									const result = ctx.nextVar();
									yield* M.Pending.append(
										Instr.Call(
											{ type: "direct", func: fr.name },
											newArgs.map(a => a.name),
											result.name,
										),
									);
									yield* M.Results.push({ tag: "value", value: result });
								});
							}
							return M.Do(function* () {
								yield* M.Results.push({ tag: "foreign", name: fr.name, arity: fr.arity, args: newArgs });
							});
						})
						.with({ tag: "primop" as const }, pr => {
							const newArgs = [...pr.args, argVal];
							if (newArgs.length === pr.arity) {
								return M.Do(function* () {
									const result = ctx.nextVar();
									yield* M.Pending.append(
										Instr.Let(
											result.name,
											E.PrimOp(
												pr.op,
												newArgs.map(a => a.name),
											),
										),
									);
									yield* M.Results.push({ tag: "value", value: result });
								});
							}
							return M.Do(function* () {
								yield* M.Results.push({ tag: "primop", op: pr.op, arity: pr.arity, args: newArgs });
							});
						})
						.with({ tag: "value" as const }, vr => {
							return M.Do(function* () {
								const fnVar = ctx.nextVar("fnref");
								const envVar = ctx.nextVar("env");
								const result = ctx.nextVar();
								yield* M.Pending.appendMany([
									Instr.Read("__fn", vr.value.name, fnVar.name),
									Instr.Read("__env", vr.value.name, envVar.name),
									Instr.Call({ type: "indirect", callee: fnVar.name }, [envVar.name, argVal.name], result.name),
								]);
								yield* M.Results.push({ tag: "value", value: result });
							});
						})
						.exhaustive();
				}),
		});
		// LIFO: push `arg` first so `func` drains first.
		yield* M.Worklist.push({ type: "Lower", ctx, term: arg });
		yield* M.Worklist.push({ type: "Lower", ctx, term: func });
	});
}

/* ================================================================================
 * Block (statements + return)
 * ================================================================================ */

function lowerBlock(stmts: EB.Statement[], ret: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();

		if (stmts.length === 0) {
			yield* M.Worklist.push({ type: "Lower", ctx, term: ret });
			return;
		}

		const [head, ...rest] = stmts;
		assert(head);
		const tail = EB.Constructors.Block(rest, ret);

		yield match(head)
			.with(
				{ type: "Let" },
				({ variable, value }): M.Lowering<void> =>
					M.Do(function* () {
						// TODO(let-rec): yap's `let` is let-rec — the bound name is in scope of its
						// own value (see `src/elaboration/inference.v2/block.ts:46-53`). We currently
						// lower it as non-rec: the value is lowered with the OUTER ctx, so any
						// reference to the bound name inside the value will resolve to whatever
						// happens to be at that index in the outer scope (which is wrong). A proper
						// fix needs:
						//   1. Pre-allocate a binder, bind it in valueCtx before lowering value, so
						//      indices line up with the elaborator.
						//   2. For Shift specifically, switch to freeVars-based capture extraction
						//      so the let-rec placeholder doesn't leak into the env record (currently
						//      `Array.from(ctx.bound.values())` would capture it).
						//   3. For self-referencing closure values, allocate the closure's name
						//      up-front and patch the closure record's env in-place (knot-tying).
						//      Self-referencing non-closure values (`let x = x + 1`) would diverge
						//      at runtime; the docs note this is accepted until we add value-
						//      restriction or laziness.
						// Hand-coded test EB terms in the meantime should use non-rec indices in
						// places where the elaborator would have produced let-rec indices.
						yield* M.Worklist.push({
							type: "Cont",
							arity: 1,
							handler: ([valueR]) =>
								M.Do(function* () {
									assert(valueR);
									const binder = C.stampNamed(variable);
									const extended = C.bind(ctx, binder, new Map([[0, valueR.value]]));
									yield* M.Worklist.push({ type: "Lower", ctx: extended, term: tail });
								}),
						});
						yield* M.Worklist.push({ type: "Lower", ctx, term: value });
					}),
			)
			.with(
				{ type: "Expression" },
				({ value }): M.Lowering<void> =>
					M.Do(function* () {
						yield* M.Worklist.push({
							type: "Cont",
							arity: 1,
							handler: () =>
								M.Do(function* () {
									yield* M.Worklist.push({ type: "Lower", ctx, term: tail });
								}),
						});
						yield* M.Worklist.push({ type: "Lower", ctx, term: value });
					}),
			)
			.with({ type: "Using" }, () => notImplemented("Using statement"))
			.exhaustive();
	});
}

/* ================================================================================
 * Lambda — closure conversion, uniformly worklist-driven
 *
 * Pattern:
 *   1. Free vars + capture analysis.
 *   2. K-call guard (docs/MIR-LOWERING.md §8 B): refuse if a captured stamp equals k.
 *   3. Pre-body allocations: `readVars` (so body's Bound refs resolve), `fnName` and
 *      `envParam` (so we can build envReads + label the lambda's pending block).
 *   4. Snapshot outer focus; open the lambda's pending block at `${fnName}_entry` with
 *      envReads as its prologue. Focus shifts to it; body emissions land here.
 *   5. Push harvest Cont + Lower(body, innerCtx). Body drains uniformly.
 *   6. Harvest Cont (post-body): peek the lambda's pending block, discard it +
 *      restore outer focus, allocate envRef (matches v1's post-body ordering for envRef),
 *      delegate to `convertClosure` which emits the lifted Fn + closure-record alloc.
 * ================================================================================ */

function lowerLambda(formal: string, body: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();

		const indices = sortedNumbers(freeVars(body, 1));
		const captured = C.resolveCaptured(ctx, indices);

		// K-call guard. docs/MIR-LOWERING.md §8 Option B: escaping continuations not supported.
		const sbc = ctx.shiftBodyCtx;
		if (sbc) {
			for (const c of captured) {
				if (c.stamp === sbc.kRef.stamp) {
					return yield* M.fail<void>({
						tag: "NotImplemented",
						what: "Lambda captures continuation k (docs/MIR-LOWERING.md §8 Option B)",
					});
				}
			}
		}

		// Pre-body allocations.
		const readVars = indices.map(() => ctx.nextVar());
		const overrides = new Map(
			indices.map((idx, j) => {
				const rv = readVars[j];
				assert(rv);
				return [idx, rv] as const;
			}),
		);
		const formalStamped = C.stampNamed(formal);
		const fnName = ctx.nextVar("fn");
		const envParam = ctx.nextVar("env");
		const envReads: MIR.Instr[] = indices.map((_, j) => {
			const rv = readVars[j];
			assert(rv);
			return Instr.Read(`v${j}`, envParam.name, rv.name);
		});
		const lambdaEntry = `${fnName.name}_entry`;
		const innerCtx = C.bind(ctx, formalStamped, overrides);

		const outerFocus = yield* M.Focus.get();
		yield* M.Pending.open(lambdaEntry, [], envReads);

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					const pending = yield* M.Pending.peek(lambdaEntry);
					assert(pending, `lowerLambda: pending block ${lambdaEntry} missing`);
					yield* M.State.modify(s => {
						const accumulated = new Map(s.accumulated);
						accumulated.delete(lambdaEntry);
						return { ...s, accumulated, focus: outerFocus };
					});

					const envRef = ctx.nextVar("env");
					const envAllocInstrs: MIR.Instr[] = [
						Instr.Alloc(
							{
								type: "Record",
								fields: indices.map((_, j) => {
									const c = captured[j];
									assert(c);
									return { label: `v${j}`, value: c.name };
								}),
							},
							envRef.name,
						),
					];

					const closureRef = yield* convertClosure(
						ctx,
						fnName.name,
						[envParam.name, formal],
						{ instrs: pending.instrs, result: bodyR },
						{ allocInstrs: envAllocInstrs, ref: envRef },
					);
					yield* M.Results.push({ tag: "value", value: closureRef });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term: body });
	});
}

/* ================================================================================
 * Reset
 *
 * Allocate a `resetExit` label, push Delimiter (so Shift can find it) + an identity
 * Cont (so the body's value propagates up when no shift fires) + Lower(body) with
 * `resetCtx` carrying the exit label. If a shift fires inside, the shift handler
 * splices off both the Delimiter and the identity Cont before they run.
 * ================================================================================ */

function lowerReset(term: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const resetExit = ctx.nextLabel("reset_exit");
		const innerCtx: C.LowerCtx = { ...ctx, resetCtx: { resetExit } };

		const state = yield* M.State.get();
		yield* M.Worklist.push({ type: "Delimiter", resultSize: state.results.length });
		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					yield* M.Results.push(bodyR);
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term });
	});
}

/* ================================================================================
 * Shift
 *
 * Algorithm (matches trace.log step-by-step — see `trace.log`):
 *   1. Find the nearest Delimiter; capture the suffix (including the enclosing reset's
 *      identity Cont) as the rest-of-reset frames.
 *   2. Capture all currently-bound vars for closure conversion (stored as env fields
 *      `v_j`, re-read at every block transition so they stay in scope).
 *   3. Append closure-alloc instrs to the outer entry block (alloc env, alloc k_ref),
 *      finalize entry with `jump s_init(k_ref)`.
 *   4. Open the `r` block with capture re-reads as its prefix — focus → r.
 *   5. Splice off [D, ...captured] from the worklist; push (bottom → top):
 *        C(assemble), L(shift body), C(bridge), ...captured frames in original order
 *      Push (...capturedResults, primer) onto the result stack.
 *   6. The regular drain takes over — no sub-drain needed:
 *        - Captured frames drain naturally, consuming primer + emitting into `r`.
 *        - `C(bridge)` fires after captured drain: pops restResult, opens `s_init`
 *          (focus → s_init), and stashes restResult for the assembler.
 *        - The shift body drains in s_init focus; k-calls split blocks as usual.
 *        - `C(assemble)` fires last: finalizes the last s_i (`jump exit(bodyValue)`),
 *          finalizes r with branch on idx, emits resetExit `(e) -> return e`.
 * ================================================================================ */

function lowerShift(body: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const rc = ctx.resetCtx;
		if (rc === undefined) {
			return yield* M.fail<void>({ tag: "ShiftWithoutReset" });
		}
		if (body.type !== "Abs" || body.binding.type !== "Lambda") {
			return yield* M.fail<void>({ tag: "InvalidShiftBody", got: body.type });
		}
		const kBinder = body.binding.variable;
		const shiftBody = body.body;

		const state = yield* M.State.get();
		const di = state.worklist.findLastIndex(f => f.type === "Delimiter");
		if (di < 0) {
			return yield* M.fail<void>({ tag: "ShiftWithoutReset" });
		}
		const delim = state.worklist[di] as Extract<M.Frame, { type: "Delimiter" }>;
		const capturedFrames = state.worklist.slice(di + 1);
		const capturedResults = state.results.slice(delim.resultSize);

		// Closure-converted captures (all currently-bound vars).
		const captures: Array<{ label: string; target: string }> = Array.from(ctx.bound.values()).map((s, j) => ({
			label: `v${j}`,
			target: s.name,
		}));

		// Allocate all shift-machinery names up front so the bridge/assemble Conts can JS-close
		// over them. Order matters for var numbering (see trace.log).
		const rLabel = ctx.nextLabel("r");
		const v_param = ctx.nextVar();
		const r_envParam = ctx.nextVar("env");
		const idx_param = ctx.nextVar("i");
		const envRef = ctx.nextVar("env");
		const kRef = ctx.nextVar("k");
		const sInit = ctx.nextLabel("s");
		const kP = ctx.nextVar("k");

		const sbc: C.ShiftBodyCtx = {
			rLabel,
			kRef,
			envRef,
			nextKCallIdx: 0,
			kResultNames: [],
			resetExit: rc.resetExit,
			captures,
			sLabels: [],
		};

		const outerFocus = state.focus;
		if (outerFocus === undefined) {
			throw new Error("Shift: no focused pending block");
		}

		// Append closure setup to outer entry; finalize with Jump(sInit). Focus is cleared.
		const envFields = captures.map(c => ({ label: c.label, value: c.target }));
		yield* M.Pending.appendMany([
			Instr.Alloc({ type: "Record", fields: envFields }, envRef.name),
			Instr.Alloc({ type: "Record", fields: [{ label: "__env", value: envRef.name }] }, kRef.name),
		]);
		yield* M.Pending.finalize(outerFocus, T.Jump(sInit, [kRef.name]));

		// Open r block; focus → r. Captured frames (about to be re-pushed) will emit here as
		// the regular drain processes them.
		const rCaptureReads = captures.map(c => Instr.Read(c.label, r_envParam.name, c.target));
		yield* M.Pending.open(rLabel, [v_param.name, r_envParam.name, idx_param.name], rCaptureReads);

		// Bind k → kRef inside the body, install shiftBodyCtx.
		const innerCtx: C.LowerCtx = {
			...C.bind(ctx, C.stampNamed(kBinder), new Map([[0, kRef]])),
			shiftBodyCtx: sbc,
		};

		// JS-closure holder for rest-of-reset's value (filled by bridge, consumed by assemble).
		const restHolder: { result?: M.ValueResult } = {};

		const bridgeCont: M.Frame = {
			type: "Cont",
			arity: 1,
			handler: ([restR]) =>
				M.Do(function* () {
					assert(restR);
					restHolder.result = restR;
					const sInitCaptureReads = captures.map(c => Instr.Read(c.label, envRef.name, c.target));
					yield* M.Pending.open(sInit, [kP.name], [Instr.Read("__env", kP.name, envRef.name), ...sInitCaptureReads]);
				}),
		};

		const assembleCont: M.Frame = {
			type: "Cont",
			arity: 1,
			handler: ([bodyResult]) =>
				M.Do(function* () {
					assert(bodyResult);
					const finalFocus = yield* M.Focus.get();
					assert(finalFocus, "Shift assembly: no focused pending block");
					yield* M.Pending.finalize(finalFocus, T.Jump(rc.resetExit, [bodyResult.value.name]));

					if (sbc.nextKCallIdx > 0) {
						const { result } = restHolder;
						assert(result, "Shift assembly: no rest result");
						const cases = sbc.sLabels.map((label, i) => ({
							value: String(i),
							target: label,
							args: [result.value.name, r_envParam.name],
						}));
						yield* M.Pending.finalize(rLabel, T.Branch(idx_param.name, cases));
					} else {
						yield* M.State.modify(s => {
							const m = new Map(s.accumulated);
							m.delete(rLabel);
							return { ...s, accumulated: m, focus: s.focus === rLabel ? undefined : s.focus };
						});
					}

					const exitParam = ctx.nextVar();
					yield* M.Pending.open(rc.resetExit, [exitParam.name]);
					yield* M.Pending.finalize(rc.resetExit, T.Return(exitParam.name));

					yield* M.Results.push({ tag: "value", value: { stamp: -1, name: "" } as C.Stamped });
				}),
		};

		// Splice [D, ...captured] from worklist; splice capturedResults from results stack.
		yield* M.State.modify(s => ({
			...s,
			worklist: s.worklist.slice(0, di),
			results: s.results.slice(0, delim.resultSize),
		}));

		// Push (bottom → top):
		//   assemble, L(shift body), bridge, ...captured (in original order — captured[N-1]
		//   lands on top, so the LIFO pop reproduces the natural drain order).
		yield* M.Worklist.push(assembleCont);
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term: shiftBody });
		yield* M.Worklist.push(bridgeCont);
		for (const f of capturedFrames) {
			yield* M.Worklist.push(f);
		}

		// Restore captured results below the primer. Primer is what the first captured Cont
		// (e.g. C(bind-v)) pops as the "value of shift" — it's r's first param `v_param`.
		for (const r of capturedResults) {
			yield* M.Results.push(r);
		}
		yield* M.Results.push({ tag: "value", value: v_param });
	});
}

/* ================================================================================
 * k-call — `App(k, arg)` inside a shift body
 *
 * Splits the current pending block: seal with `jump r(arg, env, idx)`, open a fresh
 * s_i block whose prologue stashes `v` into `env.r_idx` and re-reads all prior
 * stashes + captures (so previously-named values stay in scope wherever the rest of
 * the shift body references them).
 * ================================================================================ */

function lowerKCall(ctx: C.LowerCtx, sbc: C.ShiftBodyCtx, arg: EB.Term): M.Lowering<void> {
	return M.Do(function* () {
		const idx = sbc.nextKCallIdx++;
		const idxVar = ctx.nextVar("i");
		const kr = ctx.nextVar();

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([argResult]) =>
				M.Do(function* () {
					assert(argResult);
					yield* M.Pending.append(Instr.Let(idxVar.name, E.Lit(Lit.Num(idx))));
					const focus = yield* M.Focus.get();
					assert(focus, "kCall: no focused pending block");
					yield* M.Pending.finalize(focus, T.Jump(sbc.rLabel, [argResult.value.name, sbc.envRef.name, idxVar.name]));

					// Open new s_i: receives (v, envIn); stashes v into envIn.r_idx and re-reads
					// all stashes + captures.
					const sLabel = ctx.nextLabel("s");
					const v = ctx.nextVar();
					const envIn = ctx.nextVar("env");
					const envOut = ctx.nextVar("env");
					sbc.kResultNames.push({ idx, name: kr.name });
					sbc.sLabels.push(sLabel);

					const stashInstrs: MIR.Instr[] = [
						Instr.UpdateImmutable(envIn.name, envOut.name, {
							type: "Record",
							fields: [{ label: `r${idx}`, value: v.name }],
						}),
						...sbc.kResultNames.map(({ idx: i, name }) => Instr.Read(`r${i}`, envOut.name, name)),
						...sbc.captures.map(c => Instr.Read(c.label, envOut.name, c.target)),
					];
					yield* M.Pending.open(sLabel, [v.name, envIn.name], stashInstrs);
					sbc.envRef = envOut;

					yield* M.Results.push({ tag: "value", value: kr });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: arg });
	});
}

/* ================================================================================
 * Match — Maranget clause-matrix compilation, fully worklist-driven
 *
 * No recursion: each level of the decision tree is a Cont handler that inspects
 * its closure-captured sub-matrix, emits structural blocks, and pushes further
 * Conts + Lowers for deeper sub-matrices or leaf bodies.
 * ================================================================================ */

const TAG_FIELD = "__tag";

type VariantBranch = EB.Alternative & { pattern: { type: "Variant"; row: R.Extension<EB.Pattern, string> } };
type LitBranch = EB.Alternative & { pattern: { type: "Lit"; value: Lit.Literal } };
type StructBranch = EB.Alternative & { pattern: { type: "Struct"; row: R.Row<EB.Pattern, string> } };
type VariableBranch = EB.Alternative & { pattern: { type: "Binder" } | { type: "Wildcard" } };

const MatchPats = {
	isVariable: (p: EB.Pattern): boolean =>
		match(p)
			.with(Patterns.Pats.Binder, () => true)
			.with(Patterns.Pats.Wildcard, () => true)
			.otherwise(() => false),

	allVariable: (branches: EB.Alternative[]): boolean => branches.every(b => MatchPats.isVariable(b.pattern)),

	allVariant: (branches: EB.Alternative[]): branches is VariantBranch[] => branches.every(b => b.pattern.type === "Variant"),

	allLit: (branches: EB.Alternative[]): branches is LitBranch[] => branches.every(b => b.pattern.type === "Lit"),

	allStruct: (branches: EB.Alternative[]): branches is StructBranch[] => branches.every(b => b.pattern.type === "Struct"),
};

const MatchBranches = {
	variant: (branches: EB.Alternative[]): VariantBranch[] => branches.filter((b): b is VariantBranch => b.pattern.type === "Variant"),
	lit: (branches: EB.Alternative[]): LitBranch[] => branches.filter((b): b is LitBranch => b.pattern.type === "Lit"),
	struct: (branches: EB.Alternative[]): StructBranch[] => branches.filter((b): b is StructBranch => b.pattern.type === "Struct"),
	variable: (branches: EB.Alternative[]): VariableBranch[] => branches.filter((b): b is VariableBranch => MatchPats.isVariable(b.pattern)),
};

const MatchExtract = {
	binderName: (p: EB.Pattern): string =>
		match(p)
			.with(Patterns.Pats.Binder, ({ value }) => value)
			.otherwise(() => "_"),

	variantTag: (row: R.Row<EB.Pattern, string>): string => {
		if (row.type !== "extension") {
			throw new Error("Variant pattern must have extension row");
		}
		return row.label;
	},

	variantPayload: (row: R.Row<EB.Pattern, string>): EB.Pattern => {
		if (row.type !== "extension") {
			throw new Error("Variant pattern must have extension row");
		}
		return row.value;
	},

	structFields: (row: R.Row<EB.Pattern, string>): Array<{ label: string; pattern: EB.Pattern }> => {
		const acc: Array<{ label: string; pattern: EB.Pattern }> = [];
		let r: R.Row<EB.Pattern, string> = row;
		while (r.type === "extension") {
			acc.push({ label: r.label, pattern: r.value });
			r = r.row;
		}
		return acc;
	},

	litDisplay: (lit: Lit.Literal): string => Lit.display(lit),
};

const MatchInOrder = {
	variantTags: (branches: VariantBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const tag = b.pattern.row.label;
			return acc.includes(tag) ? acc : [...acc, tag];
		}, [] as string[]),

	litValues: (branches: LitBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const val = MatchExtract.litDisplay(b.pattern.value);
			return acc.includes(val) ? acc : [...acc, val];
		}, [] as string[]),
};

/** Project struct branches onto the pattern at the given label. */
const matchProject = (label: string, branches: StructBranch[]): EB.Alternative[] =>
	branches.map(b => {
		const fields = MatchExtract.structFields(b.pattern.row);
		const found = fields.find(f => f.label === label);
		return { pattern: found?.pattern ?? ({ type: "Wildcard" } as EB.Pattern), term: b.term, binders: b.binders };
	});

type ColumnBindings = Map<number, C.Stamped>;

/**
 * Push worklist frames for a clause sub-matrix. Called from inside Cont handlers.
 * Each call inspects the branches, emits structural blocks, and pushes Conts/Lowers
 * for deeper sub-matrices or leaf bodies.
 */
function* compileSubMatrix(
	scrutVar: C.Stamped,
	branches: EB.Alternative[],
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	if (branches.length === 0) {
		// Empty matrix → fail
		const focus = yield* M.Focus.get();
		if (focus !== undefined) {
			yield* M.Pending.finalize(focus, T.Jump(failLabel, []));
		}
		return;
	}

	const variableBranches = MatchBranches.variable(branches);

	if (MatchPats.allVariable(branches)) {
		const first = variableBranches[0];
		assert(first);
		yield* pushVariableLeaf(scrutVar, first, mergeLabel, ctx, columnBindings);
		return;
	}
	if (MatchPats.allVariant(branches) || MatchBranches.variant(branches).length > 0) {
		yield* pushVariantFrames(MatchBranches.variant(branches), scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
		return;
	}
	if (MatchPats.allLit(branches) || MatchBranches.lit(branches).length > 0) {
		yield* pushLitFrames(MatchBranches.lit(branches), scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
		return;
	}
	if (MatchPats.allStruct(branches) || MatchBranches.struct(branches).length > 0) {
		yield* pushStructFrames(MatchBranches.struct(branches), scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
		return;
	}
	throw new Error("Match lowering: unsupported pattern mix");
}

/**
 * Variable rule (leaf): bind scrutinee, push Lower for the body.
 * The current pending block is already open and focused.
 */
function* pushVariableLeaf(
	scrutVar: C.Stamped,
	branch: VariableBranch,
	mergeLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const overrides = new Map<number, C.Stamped>(columnBindings ?? []);
	overrides.set(0, scrutVar);
	const altCtx = C.bind(ctx, C.stampNamed(MatchExtract.binderName(branch.pattern)), overrides);

	yield* M.Worklist.push({
		type: "Cont",
		arity: 1,
		handler: ([bodyR]) =>
			M.Do(function* () {
				assert(bodyR);
				const focus = yield* M.Focus.get();
				if (focus !== undefined) {
					yield* M.Pending.finalize(focus, T.Jump(mergeLabel, [bodyR.value.name]));
				}
			}),
	});
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
}

/**
 * Default/variable fallback: push frames to lower the first variable branch as default.
 * Opens a fresh block for the default, pushes Lower + finalize.
 * Returns the label of the default block (for use as Branch default target).
 */
function* pushDefaultBranch(
	scrutVar: C.Stamped,
	branch: VariableBranch,
	mergeLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<string> {
	const defLabel = ctx.nextLabel("d");
	const overrides = new Map<number, C.Stamped>(columnBindings ?? []);
	overrides.set(0, scrutVar);
	const altCtx = C.bind(ctx, C.stampNamed(MatchExtract.binderName(branch.pattern)), overrides);

	yield* M.Worklist.push({
		type: "Cont",
		arity: 1,
		handler: ([bodyR]) =>
			M.Do(function* () {
				assert(bodyR);
				yield* M.Pending.finalize(defLabel, T.Jump(mergeLabel, [bodyR.value.name]));
			}),
	});
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
	yield* M.Worklist.push({
		type: "Cont",
		arity: 0,
		handler: () =>
			M.Do(function* () {
				yield* M.Pending.open(defLabel, []);
			}),
	});
	return defLabel;
}

/**
 * Variant rule: read __tag, Branch to per-tag case blocks.
 * Each tag's case block reads its payload then compiles the payload sub-matrix.
 */
function* pushVariantFrames(
	branches: VariantBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const tags = MatchInOrder.variantTags(branches);

	// Pre-allocate per-tag labels + vars
	const tagAllocs = tags.map(tag => ({
		tag,
		caseLabel: ctx.nextLabel("c"),
		scrutParam: ctx.nextVar("scrut"),
		payloadVar: ctx.nextVar(),
	}));
	const tagVar = ctx.nextVar();

	// Default case
	let defaultTarget = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		defaultTarget = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx, columnBindings);
	}

	// Build Branch cases
	const cases: MIR.Case[] = tagAllocs.map(({ tag, caseLabel }) => ({
		value: tag,
		target: caseLabel,
		args: [scrutVar.name],
	}));
	const defaultCase: MIR.DefaultCase = { target: defaultTarget, args: [] };

	// Append Read(__tag) to current focus, then finalize with Branch
	yield* M.Pending.append(Instr.Read(TAG_FIELD, scrutVar.name, tagVar.name));
	const outerFocus = yield* M.Focus.get();

	if (outerFocus === undefined) {
		throw new Error("pushVariantFrames: no focus");
	}
	yield* M.Pending.finalize(outerFocus, T.Branch(tagVar.name, cases, defaultCase));

	// Push per-tag frames (in reverse order so first tag drains first)
	for (let i = tagAllocs.length - 1; i >= 0; i--) {
		const alloc = tagAllocs[i];
		assert(alloc);
		const { tag, caseLabel, scrutParam, payloadVar } = alloc;
		const matchingBranches = branches.filter(b => b.pattern.row.label === tag);
		const payloadBranches: EB.Alternative[] = matchingBranches.map(b => ({
			pattern: MatchExtract.variantPayload(b.pattern.row),
			term: b.term,
			binders: b.binders,
		}));

		// Cont that opens the case block, then compiles the payload sub-matrix
		yield* M.Worklist.push({
			type: "Cont",
			arity: 0,
			handler: () =>
				M.Do(function* () {
					yield* M.Pending.open(caseLabel, [scrutParam.name], [Instr.Read(tag, scrutParam.name, payloadVar.name)]);
					yield* compileSubMatrix(payloadVar, payloadBranches, mergeLabel, failLabel, ctx, columnBindings);
				}),
		});
	}
}

/**
 * Lit rule: Branch on the scrutinee value. One case block per literal value.
 */
function* pushLitFrames(
	branches: LitBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const vals = MatchInOrder.litValues(branches);

	// Pre-allocate per-value labels
	const valAllocs = vals.map(val => ({
		val,
		caseLabel: ctx.nextLabel("c"),
		branch: branches.find(b => MatchExtract.litDisplay(b.pattern.value) === val),
	}));

	// Default case
	let defaultTarget = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		defaultTarget = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx, columnBindings);
	}

	// Build Branch cases
	const cases: MIR.Case[] = valAllocs.map(({ val, caseLabel }) => ({
		value: val,
		target: caseLabel,
		args: [],
	}));
	const defaultCase: MIR.DefaultCase = { target: defaultTarget, args: [] };

	// Finalize current focus with Branch
	const outerFocus = yield* M.Focus.get();

	if (outerFocus === undefined) {
		throw new Error("pushLitFrames: no focus");
	}
	yield* M.Pending.finalize(outerFocus, T.Branch(scrutVar.name, cases, defaultCase));

	// Push per-value frames (reverse order)
	for (let i = valAllocs.length - 1; i >= 0; i--) {
		const va = valAllocs[i];
		assert(va);
		const { caseLabel, branch } = va;
		assert(branch);

		// Build the ctx for the body: columnBindings shifted (lit doesn't bind)
		const litCtx = columnBindings ? { ...ctx, bound: new Map([...ctx.bound, ...[...columnBindings.entries()].map(([col, v]) => [col - 1, v] as const)]) } : ctx;

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					yield* M.Pending.finalize(caseLabel, T.Jump(mergeLabel, [bodyR.value.name]));
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx: litCtx, term: branch.term });
		yield* M.Worklist.push({
			type: "Cont",
			arity: 0,
			handler: () =>
				M.Do(function* () {
					yield* M.Pending.open(caseLabel, []);
				}),
		});
	}
}

/**
 * Struct rule: read all fields, then compile the first column as a sub-matrix.
 * Remaining columns are carried as columnBindings.
 */
function* pushStructFrames(
	branches: StructBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	_outerColumnBindings?: ColumnBindings,
): M.Glowering<void> {
	const firstBranch = branches[0];
	assert(firstBranch);
	const fields = MatchExtract.structFields(firstBranch.pattern.row);

	if (fields.length === 0) {
		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					const focus = yield* M.Focus.get();
					if (focus !== undefined) {
						yield* M.Pending.finalize(focus, T.Jump(mergeLabel, [bodyR.value.name]));
					}
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: firstBranch.term });
		return;
	}

	// Read all fields
	const fieldVars: Record<string, C.Stamped> = {};
	const readInstrs: MIR.Instr[] = [];
	for (const { label } of fields) {
		const v = ctx.nextVar();
		fieldVars[label] = v;
		readInstrs.push(Instr.Read(label, scrutVar.name, v.name));
	}
	yield* M.Pending.appendMany(readInstrs);

	// Project the matrix onto the first column
	const firstField = fields[0];
	assert(firstField);
	const firstLabel = firstField.label;
	const field0Var = fieldVars[firstLabel];
	assert(field0Var);
	const column = matchProject(firstLabel, branches);

	// columnBindings for remaining fields
	const newColumnBindings: ColumnBindings = new Map(
		fields.slice(1).map((f, i) => {
			const fv = fieldVars[f.label];
			assert(fv);
			return [i + 1, fv] as const;
		}),
	);

	// If first column is all-variable, this is a leaf
	if (MatchPats.allVariable(column)) {
		const firstCol = column[0];
		assert(firstCol);
		yield* pushVariableLeaf(field0Var, { ...firstBranch, pattern: firstCol.pattern as VariableBranch["pattern"] }, mergeLabel, ctx, newColumnBindings);
		return;
	}

	// For struct+variable mix: set up default branch using fail or variable fallback
	let actualFailLabel = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		actualFailLabel = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx);
	}

	// Compile the first column as a sub-matrix (pushes a Cont that does the analysis)
	yield* M.Worklist.push({
		type: "Cont",
		arity: 0,
		handler: () =>
			M.Do(function* () {
				yield* compileSubMatrix(field0Var, column, mergeLabel, actualFailLabel, ctx, newColumnBindings);
			}),
	});
}

/**
 * Entry point: lower a Match expression via the worklist.
 * Pushes Lower(scrutinee) + a scrutineeCont that analyzes patterns and
 * pushes the decision tree frames.
 */
function lowerMatch(scrutinee: EB.Term, alternatives: EB.Alternative[]): M.Lowering<void> {
	return M.Do(function* () {
		const ctx = yield* M.ask();
		const mergeLabel = ctx.nextLabel("j");
		const mergeParam = ctx.nextVar();
		const failLabel = ctx.nextLabel("e");

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([scrutR]) =>
				M.Do(function* () {
					assert(scrutR);
					const outerFocus = yield* M.Focus.get();
					assert(outerFocus, "lowerMatch: no focus");

					yield* M.Blocks.emit(Block(failLabel, [], [Instr.Let("__match_fail", E.Lit(Lit.String("non-exhaustive match")))], T.Return("__match_fail")));

					// Push postMatch Cont FIRST (bottom of LIFO — drains last, after all alts)
					yield* M.Worklist.push({
						type: "Cont",
						arity: 0,
						handler: () =>
							M.Do(function* () {
								yield* M.Pending.open(mergeLabel, [mergeParam.name]);
								yield* M.Results.push({ tag: "value", value: mergeParam });
							}),
					});

					// Compile the pattern matrix (pushes alt frames on top — drain first)
					yield* compileSubMatrix(scrutR.value, alternatives, mergeLabel, failLabel, ctx);
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: scrutinee });
	});
}

/* ================================================================================
 * Dispatch — one Lower frame at a time
 * ================================================================================ */

function lowerOne(term: EB.Term): M.Lowering<void> {
	return (
		match(term)
			// Type-level erasure (must precede generic shapes — Row/TypeLevelApp can nest in Proj/Inj).
			.with({ type: "Proj", term: Patterns.Row }, () => eraseTypeLevel())
			.with({ type: "Proj", term: Patterns.TypeLevelApp }, () => eraseTypeLevel())
			.with({ type: "Inj", term: Patterns.Row }, () => eraseTypeLevel())
			.with({ type: "Inj", term: Patterns.TypeLevelApp }, () => eraseTypeLevel())
			.with(Patterns.Row, () => eraseTypeLevel())
			.with(Patterns.TypeLevelApp, () => eraseTypeLevel())

			// Leaves.
			.with(Patterns.Lit, ({ value }) => lowerLit(value))
			.with(Patterns.Vars.Bound, ({ variable }) => lowerBound(variable.index))
			.with(Patterns.Vars.Free, ({ variable }) => lowerFree(variable.name))
			.with(Patterns.Vars.Foreign, ({ variable }) => lowerForeign(variable.name))

			// Compound.
			.with(Patterns.StructApp, ({ arg }) => lowerStructApp(arg.row))
			.with(Patterns.App, ({ func, arg }) => lowerApp(func, arg))
			.with(Patterns.Proj, ({ label, term: t }) => lowerProj(label, t))
			.with(Patterns.Inj, ({ label, value, term: t }) => lowerInj(label, value, t))
			.with(Patterns.Block, ({ statements, return: ret }) => lowerBlock(statements, ret))
			.with(Patterns.Lambda, ({ binding, body }) => lowerLambda(binding.variable, body))

			.with(Patterns.Reset, ({ term: t }) => lowerReset(t))
			.with(Patterns.Shift, ({ body }) => lowerShift(body))

			.with({ type: "Match" }, ({ scrutinee, alternatives }) => lowerMatch(scrutinee, alternatives))

			.otherwise(t => notImplemented(t.type))
	);
}

/* ================================================================================
 * Materialization — convert pending foreign/primop results into values
 *
 * Called by drainAll before passing results to Cont handlers. Positions marked
 * in the Cont's `saturate` set are passed through raw (for App's accumulation
 * logic). Everything else is materialized: saturated foreigns/primops emit their
 * call instruction; partial ones emit a curried closure wrapper chain.
 * ================================================================================ */

function* materializePartial(ctx: C.LowerCtx, kind: "foreign" | "primop", nameOrOp: string, arity: number, capturedArgs: C.Stamped[]): M.Glowering<C.Stamped> {
	const remaining = arity - capturedArgs.length;

	// Pre-allocate names for all wrapper levels (outermost = index 0)
	const wrappers = Array.from({ length: remaining }, () => ({
		fnName: ctx.nextVar("fn"),
		envParam: ctx.nextVar("env"),
		freshParam: ctx.nextVar(),
	}));

	// Build from innermost (last level) to outermost (first level)
	for (let level = remaining - 1; level >= 0; level--) {
		const w = wrappers[level];
		assert(w);
		const { fnName, envParam, freshParam } = w;
		const numCaptured = capturedArgs.length + level;

		const bodyReads: C.Stamped[] = [];
		const bodyInstrs: MIR.Instr[] = [];
		for (let j = 0; j < numCaptured; j++) {
			const v = ctx.nextVar();
			bodyReads.push(v);
			bodyInstrs.push(Instr.Read(`v${j}`, envParam.name, v.name));
		}
		const allArgs = [...bodyReads, freshParam];

		if (level === remaining - 1) {
			// Innermost: emit the saturated call
			const callResult = ctx.nextVar();
			if (kind === "primop") {
				bodyInstrs.push(
					Instr.Let(
						callResult.name,
						E.PrimOp(
							nameOrOp,
							allArgs.map(a => a.name),
						),
					),
				);
			} else {
				bodyInstrs.push(
					Instr.Call(
						{ type: "direct", func: nameOrOp },
						allArgs.map(a => a.name),
						callResult.name,
					),
				);
			}
			const block = Block(`${fnName.name}_entry`, [], bodyInstrs, T.Return(callResult.name));
			yield* M.Functions.emit(Fn(fnName.name, [envParam.name, freshParam.name], block.label, [block]));
		} else {
			// Intermediate: create closure for next level
			const next = wrappers[level + 1];
			assert(next);
			const newEnvRef = ctx.nextVar("env");
			const newFnRef = ctx.nextVar("fnref");
			const closureRef = ctx.nextVar("closure");
			bodyInstrs.push(
				Instr.Alloc({ type: "Record", fields: allArgs.map((a, i) => ({ label: `v${i}`, value: a.name })) }, newEnvRef.name),
				Instr.Let(newFnRef.name, E.FuncRef(next.fnName.name)),
				Instr.Alloc(
					{
						type: "Record",
						fields: [
							{ label: "__fn", value: newFnRef.name },
							{ label: "__env", value: newEnvRef.name },
						],
					},
					closureRef.name,
				),
			);
			const block = Block(`${fnName.name}_entry`, [], bodyInstrs, T.Return(closureRef.name));
			yield* M.Functions.emit(Fn(fnName.name, [envParam.name, freshParam.name], block.label, [block]));
		}
	}

	// Outer: alloc env with captured args, create closure pointing to first wrapper
	const outerWrapper = wrappers[0];
	assert(outerWrapper);
	const envRef = ctx.nextVar("env");
	const fnRef = ctx.nextVar("fnref");
	const closureRef = ctx.nextVar("closure");
	yield* M.Pending.appendMany([
		Instr.Alloc({ type: "Record", fields: capturedArgs.map((a, i) => ({ label: `v${i}`, value: a.name })) }, envRef.name),
		Instr.Let(fnRef.name, E.FuncRef(outerWrapper.fnName.name)),
		Instr.Alloc(
			{
				type: "Record",
				fields: [
					{ label: "__fn", value: fnRef.name },
					{ label: "__env", value: envRef.name },
				],
			},
			closureRef.name,
		),
	]);
	return closureRef;
}

function* materialize(results: M.LowerResult[], saturate: Set<number>): M.Glowering<M.LowerResult[]> {
	const ctx = yield* M.ask();
	const out: M.LowerResult[] = [];

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		assert(r);
		if (saturate.has(i)) {
			out.push(r);
			continue;
		}
		if (r.tag === "value") {
			out.push(r);
			continue;
		}
		const nameOrOp = r.tag === "foreign" ? r.name : r.op;
		if (r.args.length === r.arity) {
			const result = ctx.nextVar();
			if (r.tag === "primop") {
				yield* M.Pending.append(
					Instr.Let(
						result.name,
						E.PrimOp(
							nameOrOp,
							r.args.map(a => a.name),
						),
					),
				);
			} else {
				yield* M.Pending.append(
					Instr.Call(
						{ type: "direct", func: nameOrOp },
						r.args.map(a => a.name),
						result.name,
					),
				);
			}
			out.push({ tag: "value", value: result });
		} else {
			const closureRef = yield* materializePartial(ctx, r.tag, nameOrOp, r.arity, r.args);
			out.push({ tag: "value", value: closureRef });
		}
	}
	return out;
}

/* ================================================================================
 * Drain loop
 * ================================================================================ */

function* drainAll(): M.Glowering<void> {
	while (true) {
		const frame = yield* M.Worklist.pop();

		if (frame === undefined) {
			return;
		}

		if (frame.type === "Cont") {
			const raw = yield* M.Results.pop(frame.arity);
			const results = (yield* materialize(raw, new Set())) as M.ValueResult[];
			yield frame.handler(results);
			continue;
		}
		if (frame.type === "Cont:sat") {
			const raw = yield* M.Results.pop(frame.arity);
			const results = yield* materialize(raw, frame.saturate);
			yield frame.handler(results);
			continue;
		}
		if (frame.type === "Delimiter") {
			// Inert marker — consumed by Shift's suffix-capture logic.
			continue;
		}
		// Lower: dispatch under the frame's ctx, not the surrounding one.
		yield* M.local(_ => frame.ctx, lowerOne(frame.term));
	}
}

/* ================================================================================
 * Entry point
 * ================================================================================ */

export function lowerToMir(term: EB.Term, declarations?: Map<string, MIR.Declaration>): MIR.Module {
	C.resetSupply();
	MIR.resetId();

	const ctx = C.mkCtx({ declarations });
	const ENTRY = "entry";

	const program: M.Lowering<void> = M.Do(function* () {
		yield* M.Pending.open(ENTRY, []);
		yield* M.Worklist.push({ type: "Lower", ctx, term });
		yield* drainAll();
		const [rawResult] = yield* M.Results.pop(1);
		assert(rawResult);
		const [result] = (yield* materialize([rawResult], new Set())) as M.ValueResult[];
		assert(result);
		// If a top-level Shift fired, it finalized all pending blocks — skip.
		// If a Match is at the top level, the current focus is the merge block (not "entry").
		// Finalize whatever the current focus is with Return.
		const finalFocus = yield* M.Focus.get();
		if (finalFocus !== undefined) {
			yield* M.Pending.finalize(finalFocus, T.Return(result.value.name));
		}
	});

	const [collected] = M.run(program, ctx);
	if (collected.result._tag === "Left") {
		throw new Error(`lowering failed: ${M.display(collected.result.left)}`);
	}
	const mainFn = Fn("main", [], ENTRY, collected.blocks);
	const mirDeclarations = declarations ? Array.from(declarations.values()) : [];
	return Module([mainFn, ...collected.functions], mirDeclarations);
}
