import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as MIR from "../mir";
import * as M from "../monad";
import type * as C from "../context";
import { Pats, filterVariable, Conts, pushVariableLeaf, type ColumnBindings } from "./shared";
import * as Variant from "./variant";
import * as Literal from "./literal";
import * as Struct from "./struct";

const { Block, Instr, Expr: E, Terminator: T } = MIR.Constructors;

export function* compileSubMatrix(
	scrutVar: C.Stamped,
	branches: EB.Alternative[],
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	if (branches.length === 0) {
		const focus = yield* M.Focus.get();
		if (focus !== undefined) {
			yield* M.Pending.finalize(focus, T.Jump(failLabel, []));
		}
		return;
	}

	const variableBranches = filterVariable(branches);
	const variantBranches = Variant.filter(branches);
	const litBranches = Literal.filter(branches);
	const structBranches = Struct.filter(branches);

	if (Pats.allVariable(branches)) {
		const first = variableBranches[0];
		assert(first);
		return yield* pushVariableLeaf(scrutVar, first, mergeLabel, ctx, columnBindings);
	}
	if (variantBranches.length > 0) {
		return yield* Variant.lower(variantBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	if (litBranches.length > 0) {
		return yield* Literal.lower(litBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	if (structBranches.length > 0) {
		return yield* Struct.lower(structBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	throw new Error("Match lowering: unsupported pattern mix");
}

export function lower(scrutinee: EB.Term, alternatives: EB.Alternative[]): M.Lowering<void> {
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

					yield* M.Worklist.push({
						type: "Cont",
						arity: 0,
						handler: () =>
							M.Do(function* () {
								yield* M.Pending.open(mergeLabel, [mergeParam.name]);
								yield* M.Results.push({ tag: "value", value: mergeParam });
							}),
					});

					yield* compileSubMatrix(scrutR.value, alternatives, mergeLabel, failLabel, ctx);
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: scrutinee });
	});
}
