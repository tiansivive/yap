/**
 * Lowering — worklist-driven, monad-hosted compilation from EB terms to MIR.
 *
 * This file contains only the top-level dispatch, the drain loop, and the entry
 * point. Individual lowering rules live in dedicated modules:
 *   - leaf.ts        — literals, variables, type-level erasure
 *   - struct.ts      — struct data, projection, injection
 *   - block.ts       — let/do statement sequencing
 *   - functions/     — lambda (closure conversion), application, materialization
 *   - continuations/ — reset, shift, k-call
 *   - match.ts       — Maranget clause-matrix compilation
 */

import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "./mir";
import * as M from "./monad";
import * as C from "./context";
import { Patterns } from "./patterns";
import { notImplemented } from "./shared/helpers";

import * as Leaf from "./leaf";
import * as Struct from "./struct";
import * as Block from "./block";
import * as Functions from "./functions";
import * as Continuation from "./continuations";
import * as Match from "./matching";

const { Terminator: T, Function: Fn, Module } = MIR.Constructors;

/* ================================================================================
 * Dispatch — one Lower frame at a time
 * ================================================================================ */

function lower(ctx: C.LowerCtx, term: EB.Term): M.Lowering<void> {
	const sbc = ctx.shiftBodyCtx;
	return (
		match(term)
			// Type-level erasure (must precede generic shapes — Row/TypeLevelApp can nest in Proj/Inj).
			.with({ type: "Proj", term: Patterns.Row }, () => Leaf.erase())
			.with({ type: "Proj", term: Patterns.TypeLevelApp }, () => Leaf.erase())
			.with({ type: "Inj", term: Patterns.Row }, () => Leaf.erase())
			.with({ type: "Inj", term: Patterns.TypeLevelApp }, () => Leaf.erase())
			.with(Patterns.Row, () => Leaf.erase())
			.with(Patterns.TypeLevelApp, () => Leaf.erase())

			// Leaves.
			.with(Patterns.Lit, ({ value }) => Leaf.literal(value))
			.with(Patterns.Vars.Bound, ({ variable }) => Leaf.bound(variable.index))
			.with(Patterns.Vars.Free, ({ variable }) => Leaf.free(variable.name))
			.with(Patterns.Vars.Foreign, ({ variable }) => Leaf.foreign(variable.name))

			// Compound.
			.with(Patterns.StructApp, ({ arg }) => Struct.data(arg.row))
			// k-call: App whose head is the bound continuation k inside a shift body.
			.with(
				{ type: "App", func: { type: "Var", variable: { type: "Bound" } } },
				({ func }) => sbc !== undefined && ctx.bound.get(func.variable.index)?.stamp === sbc.kRef.stamp,
				({ arg }) => {
					assert(sbc);
					return Continuation.KCall.lower(ctx, sbc, arg);
				},
			)
			.with(Patterns.App, ({ func, arg }) => Functions.App.lower(func, arg))
			.with(Patterns.Proj, ({ label, term: t }) => Struct.projection(label, t))
			.with(Patterns.Inj, ({ label, value, term: t }) => Struct.injection(label, value, t))
			.with(Patterns.Block, ({ statements, return: ret }) => Block.lower(statements, ret))
			.with(Patterns.Lambda, ({ binding, body }) => Functions.Lambda.lower(binding.variable, body))

			.with(Patterns.Reset, ({ term: t }) => Continuation.Reset.lower(t))
			.with(Patterns.Shift, ({ body }) => Continuation.Shift.lower(body))

			.with({ type: "Match" }, ({ scrutinee, alternatives }) => Match.lower(scrutinee, alternatives))

			.with({ type: "Ann" }, ({ term }) => lower(ctx, term))
			.otherwise(t => notImplemented(t.type))
	);
}

/* ================================================================================
 * Driver loop
 * ================================================================================ */

function* driver(): M.Glowering<void> {
	while (true) {
		const frame = yield* M.Worklist.pop();

		if (frame === undefined) {
			return;
		}

		if (frame.type === "Cont") {
			const raw = yield* M.Results.pop(frame.arity);
			const results = (yield* Functions.materialize(raw, new Set())) as M.ValueResult[];
			yield frame.handler(results);
			continue;
		}
		if (frame.type === "Cont:sat") {
			const raw = yield* M.Results.pop(frame.arity);
			const results = yield* Functions.materialize(raw, frame.saturate);
			yield frame.handler(results);
			continue;
		}
		if (frame.type === "Delimiter") {
			continue;
		}
		// Lower: dispatch under the frame's ctx.
		yield* M.local(_ => frame.ctx, lower(frame.ctx, frame.term));
	}
}

/* ================================================================================
 * Entry point
 * ================================================================================ */

/** @deprecated Use GRAM.Bridge.emit instead. */
export function lowerToMir(term: EB.Term, declarations?: Map<string, MIR.Declaration>): MIR.Module {
	C.resetSupply();
	MIR.resetId();

	const ctx = C.mkCtx({ declarations });
	const ENTRY = "entry";

	const program: M.Lowering<void> = M.Do(function* () {
		yield* M.Pending.open(ENTRY, []);
		yield* M.Worklist.push({ type: "Lower", ctx, term });
		yield* driver();
		const [rawResult] = yield* M.Results.pop(1);
		assert(rawResult);
		const [result] = (yield* Functions.materialize([rawResult], new Set())) as M.ValueResult[];
		assert(result);
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
