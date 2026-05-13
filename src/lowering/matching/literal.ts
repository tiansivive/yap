import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as MIR from "../mir";
import * as M from "../monad";
import * as C from "../context";
import type { VariableBranch, ColumnBindings } from "./shared";
import { Conts, pushDefaultBranch } from "./shared";

const { Terminator: T } = MIR.Constructors;

export type LitBranch = EB.Alternative & { pattern: { type: "Lit"; value: Lit.Literal } };

export const filter = (branches: EB.Alternative[]): LitBranch[] => branches.filter((b): b is LitBranch => b.pattern.type === "Lit");

export const display = (lit: Lit.Literal): string => Lit.display(lit);

export const values = (branches: LitBranch[]): string[] =>
	branches.reduce((acc, b) => {
		const val = display(b.pattern.value);
		return acc.includes(val) ? acc : [...acc, val];
	}, [] as string[]);

export function* lower(
	branches: LitBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const vals = values(branches);

	const valAllocs = vals.map(val => ({
		val,
		caseLabel: ctx.nextLabel("c"),
		branch: branches.find(b => display(b.pattern.value) === val),
	}));

	const defaultTarget = variableBranches[0] ? yield* pushDefaultBranch(scrutVar, variableBranches[0], mergeLabel, ctx, columnBindings) : failLabel;

	const cases: MIR.Case[] = valAllocs.map(({ val, caseLabel }) => ({
		value: val,
		target: caseLabel,
		args: [],
	}));
	const defaultCase: MIR.DefaultCase = { target: defaultTarget, args: [] };

	const outerFocus = yield* M.Focus.get();

	if (outerFocus === undefined) {
		throw new Error("pushLitFrames: no focus");
	}
	yield* M.Pending.finalize(outerFocus, T.Branch(scrutVar.name, cases, defaultCase));

	const litCtx = columnBindings ? C.bindColumns(ctx, columnBindings) : ctx;

	yield* M.traverse(valAllocs.toReversed(), function* ({ caseLabel, branch }) {
		assert(branch);
		yield* M.Worklist.push(Conts.seal(caseLabel, mergeLabel));
		yield* M.Worklist.push({ type: "Lower", ctx: litCtx, term: branch.term });
		yield* M.Worklist.push(Conts.open(caseLabel));
	});
}
