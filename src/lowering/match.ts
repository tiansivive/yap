/**
 * Match lowering — Maranget clause-matrix compilation, fully worklist-driven.
 *
 * Each level of the decision tree is a Cont handler that inspects its closure-captured
 * sub-matrix, emits structural blocks, and pushes further Conts + Lowers for deeper
 * sub-matrices or leaf bodies.
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

const { Block, Instr, Expr: E, Terminator: T } = MIR.Constructors;

const Conts = {
	open: (label: string): M.Frame => ({
		type: "Cont",
		arity: 0,
		handler: () =>
			M.Do(function* () {
				yield* M.Pending.open(label, []);
			}),
	}),
	seal: (label: string, mergeLabel: string): M.Frame => ({
		type: "Cont",
		arity: 1,
		handler: ([bodyR]) =>
			M.Do(function* () {
				assert(bodyR);
				yield* M.Pending.finalize(label, T.Jump(mergeLabel, [bodyR.value.name]));
			}),
	}),
	sealFocus: (mergeLabel: string): M.Frame => ({
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
	}),
};

const TAG_FIELD = "__tag";

type VariantBranch = EB.Alternative & { pattern: { type: "Variant"; row: R.Extension<EB.Pattern, string> } };
type LitBranch = EB.Alternative & { pattern: { type: "Lit"; value: Lit.Literal } };
type StructBranch = EB.Alternative & { pattern: { type: "Struct"; row: R.Row<EB.Pattern, string> } };
type VariableBranch = EB.Alternative & { pattern: { type: "Binder" } | { type: "Wildcard" } };

const Pats = {
	isVariable: (p: EB.Pattern): boolean =>
		match(p)
			.with(Patterns.Pats.Binder, () => true)
			.with(Patterns.Pats.Wildcard, () => true)
			.otherwise(() => false),

	allVariable: (branches: EB.Alternative[]): boolean => branches.every(b => Pats.isVariable(b.pattern)),
};

const Branches = {
	variant: (branches: EB.Alternative[]): VariantBranch[] => branches.filter((b): b is VariantBranch => b.pattern.type === "Variant"),
	lit: (branches: EB.Alternative[]): LitBranch[] => branches.filter((b): b is LitBranch => b.pattern.type === "Lit"),
	struct: (branches: EB.Alternative[]): StructBranch[] => branches.filter((b): b is StructBranch => b.pattern.type === "Struct"),
	variable: (branches: EB.Alternative[]): VariableBranch[] => branches.filter((b): b is VariableBranch => Pats.isVariable(b.pattern)),
};

const Extract = {
	binderName: (p: EB.Pattern): string =>
		match(p)
			.with(Patterns.Pats.Binder, ({ value }) => value)
			.otherwise(() => "_"),

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

const InOrder = {
	variantTags: (branches: VariantBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const tag = b.pattern.row.label;
			return acc.includes(tag) ? acc : [...acc, tag];
		}, [] as string[]),

	litValues: (branches: LitBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const val = Extract.litDisplay(b.pattern.value);
			return acc.includes(val) ? acc : [...acc, val];
		}, [] as string[]),
};

const project = (label: string, branches: StructBranch[]): EB.Alternative[] =>
	branches.map(b => {
		const fields = Extract.structFields(b.pattern.row);
		const found = fields.find(f => f.label === label);
		return { pattern: found?.pattern ?? ({ type: "Wildcard" } as EB.Pattern), term: b.term, binders: b.binders };
	});

type ColumnBindings = Map<number, C.Stamped>;

function* compileSubMatrix(
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

	const variableBranches = Branches.variable(branches);
	const variantBranches = Branches.variant(branches);
	const litBranches = Branches.lit(branches);
	const structBranches = Branches.struct(branches);

	if (Pats.allVariable(branches)) {
		const first = variableBranches[0];
		assert(first);
		return yield* pushVariableLeaf(scrutVar, first, mergeLabel, ctx, columnBindings);
	}
	if (variantBranches.length > 0) {
		return yield* pushVariantFrames(variantBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	if (litBranches.length > 0) {
		return yield* pushLitFrames(litBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	if (structBranches.length > 0) {
		return yield* pushStructFrames(structBranches, scrutVar, mergeLabel, failLabel, ctx, variableBranches, columnBindings);
	}
	throw new Error("Match lowering: unsupported pattern mix");
}

function* pushVariableLeaf(
	scrutVar: C.Stamped,
	branch: VariableBranch,
	mergeLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const overrides = new Map<number, C.Stamped>(columnBindings ?? []);
	overrides.set(0, scrutVar);
	const altCtx = C.bind(ctx, C.stampNamed(Extract.binderName(branch.pattern)), overrides);

	yield* M.Worklist.push(Conts.sealFocus(mergeLabel));
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
}

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
	const altCtx = C.bind(ctx, C.stampNamed(Extract.binderName(branch.pattern)), overrides);

	yield* M.Worklist.push(Conts.seal(defLabel, mergeLabel));
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
	yield* M.Worklist.push(Conts.open(defLabel));
	return defLabel;
}

function* pushVariantFrames(
	branches: VariantBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const tags = InOrder.variantTags(branches);
	const tagAllocs = tags.map(tag => ({
		tag,
		caseLabel: ctx.nextLabel("c"),
		scrutParam: ctx.nextVar("scrut"),
		payloadVar: ctx.nextVar(),
	}));
	const tagVar = ctx.nextVar();

	let defaultTarget = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		defaultTarget = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx, columnBindings);
	}

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

	for (let i = tagAllocs.length - 1; i >= 0; i--) {
		const alloc = tagAllocs[i];
		assert(alloc);
		const { tag, caseLabel, scrutParam, payloadVar } = alloc;
		const matchingBranches = branches.filter(b => b.pattern.row.label === tag);
		const payloadBranches: EB.Alternative[] = matchingBranches.map(b => ({
			pattern: Extract.variantPayload(b.pattern.row),
			term: b.term,
			binders: b.binders,
		}));

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

function* pushLitFrames(
	branches: LitBranch[],
	scrutVar: C.Stamped,
	mergeLabel: string,
	failLabel: string,
	ctx: C.LowerCtx,
	variableBranches: VariableBranch[],
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const vals = InOrder.litValues(branches);

	const valAllocs = vals.map(val => ({
		val,
		caseLabel: ctx.nextLabel("c"),
		branch: branches.find(b => Extract.litDisplay(b.pattern.value) === val),
	}));

	let defaultTarget = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		defaultTarget = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx, columnBindings);
	}

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

	for (let i = valAllocs.length - 1; i >= 0; i--) {
		const va = valAllocs[i];
		assert(va);
		const { caseLabel, branch } = va;
		assert(branch);

		const litCtx = columnBindings ? C.bindColumns(ctx, columnBindings) : ctx;

		yield* M.Worklist.push(Conts.seal(caseLabel, mergeLabel));
		yield* M.Worklist.push({ type: "Lower", ctx: litCtx, term: branch.term });
		yield* M.Worklist.push(Conts.open(caseLabel));
	}
}

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
	const fields = Extract.structFields(firstBranch.pattern.row);

	if (fields.length === 0) {
		yield* M.Worklist.push(Conts.sealFocus(mergeLabel));
		yield* M.Worklist.push({ type: "Lower", ctx, term: firstBranch.term });
		return;
	}

	const fieldVars: Record<string, C.Stamped> = {};
	const readInstrs: MIR.Instr[] = [];
	for (const { label } of fields) {
		const v = ctx.nextVar();
		fieldVars[label] = v;
		readInstrs.push(Instr.Read(label, scrutVar.name, v.name));
	}
	yield* M.Pending.appendMany(readInstrs);

	const firstField = fields[0];
	assert(firstField);
	const firstLabel = firstField.label;
	const field0Var = fieldVars[firstLabel];
	assert(field0Var);
	const column = project(firstLabel, branches);

	const newColumnBindings: ColumnBindings = new Map(
		fields.slice(1).map((f, i) => {
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

	let actualFailLabel = failLabel;
	if (variableBranches.length > 0) {
		const vb = variableBranches[0];
		assert(vb);
		actualFailLabel = yield* pushDefaultBranch(scrutVar, vb, mergeLabel, ctx);
	}

	yield* M.Worklist.push({
		type: "Cont",
		arity: 0,
		handler: () =>
			M.Do(function* () {
				yield* compileSubMatrix(field0Var, column, mergeLabel, actualFailLabel, ctx, newColumnBindings);
			}),
	});
}

export function lowerMatch(scrutinee: EB.Term, alternatives: EB.Alternative[]): M.Lowering<void> {
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
