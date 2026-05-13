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
import * as MIR from "./mir";
import * as M from "./monad";
import * as C from "./context";
import { Patterns } from "./patterns";
import { freeVars, sortedNumbers } from "./shared/freevars";
import * as Closure from "./closures";
import { lowerMatch } from "./match";
import { materialize, call as emitCall } from "./materialize";

const { Instr, Expr: E, Terminator: T, Function: Fn, Module } = MIR.Constructors;

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
			return yield* M.Results.push({ tag: "value", value: stamped });
		}
		const primArity = PRIMOP_ARITIES[name];
		if (primArity !== undefined) {
			return yield* M.Results.push({ tag: "primop", op: name, arity: primArity, args: [] });
		}
		const decl = ctx.declarations.get(name);
		if (decl !== undefined) {
			return yield* M.Results.push({ tag: "foreign", name, arity: decl.arity, args: [] });
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
					assert(argR.tag === "value");
					const argVal = argR.value;
					yield match(funcR)
						.with({ tag: "foreign" }, { tag: "primop" }, pending => {
							return M.Do(function* () {
								const saturated = { ...pending, args: [...pending.args, argVal] };
								const next = saturated.args.length === saturated.arity ? yield* emitCall(ctx, saturated) : saturated;
								yield* M.Results.push(next);
							});
						})
						.with({ tag: "value" }, vr => {
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

					const closureRef = yield* Closure.convert(ctx, fnName.name, [envParam.name, formal], { instrs: pending.instrs, result: bodyR }, captured);
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

		const envFields = captures.map(c => ({ label: c.label, value: c.target }));
		yield* M.Pending.appendMany([
			Instr.Alloc({ type: "Record", fields: envFields }, envRef.name),
			Instr.Alloc({ type: "Record", fields: [{ label: "__env", value: envRef.name }] }, kRef.name),
		]);
		yield* M.Pending.finalize(outerFocus, T.Jump(sInit, [kRef.name]));

		const rCaptureReads = captures.map(c => Instr.Read(c.label, r_envParam.name, c.target));
		yield* M.Pending.open(rLabel, [v_param.name, r_envParam.name, idx_param.name], rCaptureReads);

		const innerCtx: C.LowerCtx = {
			...C.bind(ctx, C.stampNamed(kBinder), new Map([[0, kRef]])),
			shiftBodyCtx: sbc,
		};

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
