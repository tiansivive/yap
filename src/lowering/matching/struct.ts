import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";
import * as MIR from "../mir";
import * as M from "../monad";
import type * as C from "../context";
import type { VariableBranch, ColumnBindings } from "./shared";
import { Pats, Conts, pushVariableLeaf, pushDefaultBranch } from "./shared";
import { compileSubMatrix } from "./index";

const { Instr } = MIR.Constructors;

export type StructBranch = EB.Alternative & { pattern: { type: "Struct"; row: R.Row<EB.Pattern, string> } };

export const filter = (branches: EB.Alternative[]): StructBranch[] => branches.filter((b): b is StructBranch => b.pattern.type === "Struct");

export const fields = (row: R.Row<EB.Pattern, string>): Array<{ label: string; pattern: EB.Pattern }> =>
	row.type === "extension" ? [{ label: row.label, pattern: row.value }, ...fields(row.row)] : [];

export const project = (label: string, branches: StructBranch[]): EB.Alternative[] =>
	branches.map(b => {
		const fs = fields(b.pattern.row);
		const found = fs.find(f => f.label === label);
		return { pattern: found?.pattern ?? ({ type: "Wildcard" } as EB.Pattern), term: b.term, binders: b.binders };
	});

export function* lower(
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
	const allFields = fields(firstBranch.pattern.row);

	if (allFields.length === 0) {
		yield* M.Worklist.push(Conts.sealFocus(mergeLabel));
		yield* M.Worklist.push({ type: "Lower", ctx, term: firstBranch.term });
		return;
	}

	const { fieldVars, readInstrs } = allFields.reduce<{ fieldVars: Record<string, C.Stamped>; readInstrs: MIR.Instr[] }>(
		(acc, { label }) => {
			const v = ctx.nextVar();
			return {
				fieldVars: { ...acc.fieldVars, [label]: v },
				readInstrs: [...acc.readInstrs, Instr.Read(label, scrutVar.name, v.name)],
			};
		},
		{ fieldVars: {}, readInstrs: [] },
	);
	yield* M.Pending.appendMany(readInstrs);

	const firstField = allFields[0];
	assert(firstField);
	const firstLabel = firstField.label;
	const field0Var = fieldVars[firstLabel];
	assert(field0Var);
	const column = project(firstLabel, branches);

	const newColumnBindings: ColumnBindings = new Map(
		allFields.slice(1).map((f, i) => {
			const fv = fieldVars[f.label];
			assert(fv);
			return [i + 1, fv] as const;
		}),
	);

	if (Pats.allVariable(column)) {
		const firstCol = column[0];
		assert(firstCol);
		yield* pushVariableLeaf(field0Var, { ...firstBranch, pattern: firstCol.pattern as VariableBranch["pattern"] }, mergeLabel, ctx, newColumnBindings);
		return;
	}

	const actualFailLabel = variableBranches[0] ? yield* pushDefaultBranch(scrutVar, variableBranches[0], mergeLabel, ctx) : failLabel;

	yield* M.Worklist.push({
		type: "Cont",
		arity: 0,
		handler: () =>
			M.Do(function* () {
				yield* compileSubMatrix(field0Var, column, mergeLabel, actualFailLabel, ctx, newColumnBindings);
			}),
	});
}
