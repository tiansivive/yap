import type * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";
import * as MIR from "../mir";
import * as M from "../monad";
import type * as C from "../context";
import type { VariableBranch, ColumnBindings } from "./shared";
import { pushDefaultBranch } from "./shared";
import { compileSubMatrix } from "./index";

const { Instr, Terminator: T } = MIR.Constructors;

const TAG_FIELD = "__tag";

export type VariantBranch = EB.Alternative & { pattern: { type: "Variant"; row: R.Extension<EB.Pattern, string> } };

export const filter = (branches: EB.Alternative[]): VariantBranch[] => branches.filter((b): b is VariantBranch => b.pattern.type === "Variant");

export const tags = (branches: VariantBranch[]): string[] =>
	branches.reduce((acc, b) => {
		const tag = b.pattern.row.label;
		return acc.includes(tag) ? acc : [...acc, tag];
	}, [] as string[]);

export const payload = (row: R.Row<EB.Pattern, string>): EB.Pattern => {
	if (row.type !== "extension") {
		throw new Error("Variant pattern must have extension row");
	}
	return row.value;
};

export function* lower(
	branches: VariantBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const allTags = tags(branches);
	const tagAllocs = allTags.map(tag => ({
		tag,
		caseLabel: ctx.nextLabel("c"),
		scrutParam: ctx.nextVar("scrut"),
		payloadVar: ctx.nextVar(),
	}));
	const tagVar = ctx.nextVar();

	const defaultTarget = variableBranches[0] ? yield* pushDefaultBranch(scrutVar, variableBranches[0], mergeLabel, ctx, columnBindings) : failLabel;

	const cases: MIR.Case[] = tagAllocs.map(({ tag, caseLabel }) => ({
		value: tag,
		target: caseLabel,
		args: [scrutVar.name],
	}));
	const defaultCase: MIR.DefaultCase = { target: defaultTarget, args: [] };

	yield* M.Pending.append(Instr.Read(TAG_FIELD, scrutVar.name, tagVar.name));
	const outerFocus = yield* M.Focus.get();

	if (outerFocus === undefined) {
		throw new Error("pushVariantFrames: no focus");
	}
	yield* M.Pending.finalize(outerFocus, T.Branch(tagVar.name, cases, defaultCase));

	yield* M.traverse(tagAllocs.toReversed(), function* ({ tag, caseLabel, scrutParam, payloadVar }) {
		const payloadBranches: EB.Alternative[] = branches
			.filter(b => b.pattern.row.label === tag)
			.map(b => ({ pattern: payload(b.pattern.row), term: b.term, binders: b.binders }));

		yield* M.Worklist.push({
			type: "Cont",
			arity: 0,
			handler: () =>
				M.Do(function* () {
					yield* M.Pending.open(caseLabel, [scrutParam.name], [Instr.Read("payload", scrutParam.name, payloadVar.name)]);
					yield* compileSubMatrix(payloadVar, payloadBranches, mergeLabel, failLabel, ctx, columnBindings);
				}),
		});
	});
}
