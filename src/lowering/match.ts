import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { match } from "ts-pattern";
import * as MIR from "./mir";
import { Patterns } from "./patterns";
import type { LowerCtx, LowerResult } from "./context";
import { bind } from "./context";
import type { Case, DefaultCase } from "./mir";

const TAG_FIELD = "__tag";

/** Narrowed alternative types for compile-matrix branches. */
type VariantBranch = EB.Alternative & { pattern: { type: "Variant"; row: R.Extension<EB.Pattern, string> } };
type LitBranch = EB.Alternative & { pattern: { type: "Lit"; value: Lit.Literal } };
type StructBranch = EB.Alternative & { pattern: { type: "Struct"; row: R.Row<EB.Pattern, string> } };
type VariableBranch = EB.Alternative & { pattern: { type: "Binder" } | { type: "Wildcard" } };

/** Result of compiling a clause matrix to a decision tree. */
type CompileResult = {
	blocks: MIR.Block[];
	entry: { label: string; instrs: MIR.Instr[]; terminator: MIR.Terminator };
};

type CompileEnv = {
	scrutVar: string;
	mergeLabel: string;
	failLabel: string;
	ctx: LowerCtx;
	lower: (t: EB.Term, c: LowerCtx) => LowerResult;
	/** For multi-column (e.g. struct): maps binder index → MIR var for columns already projected. */
	columnBindings?: Map<number, string>;
};

/** Build overrides for binding: scrutinee at index 0, plus columnBindings for other columns. */
const overridesFor = (scrutVar: string, env: CompileEnv): Map<number, string> => {
	const m = new Map(env.columnBindings ?? []);
	m.set(0, scrutVar);
	return m;
};

/** Build overrides for Lit branch: columnBindings map column index → var; binder index i = column i+1. */
const overridesForLit = (env: CompileEnv): Map<number, string> => new Map([...(env.columnBindings ?? []).entries()].map(([col, v]) => [col - 1, v] as const));

/** Pattern predicates and branch classifiers. */
const Pats = {
	isVariable: (p: EB.Pattern): boolean =>
		match(p)
			.with(Patterns.Pats.Binder, () => true)
			.with(Patterns.Pats.Wildcard, () => true)
			.otherwise(() => false),

	allVariable: (branches: EB.Alternative[]): boolean => branches.every(b => Pats.isVariable(b.pattern)),
	allVariant: (branches: EB.Alternative[]): branches is VariantBranch[] => branches.every(b => b.pattern.type === "Variant"),
	allLit: (branches: EB.Alternative[]): branches is LitBranch[] => branches.every(b => b.pattern.type === "Lit"),
	allStruct: (branches: EB.Alternative[]): branches is StructBranch[] => branches.every(b => b.pattern.type === "Struct"),
	allList: (branches: EB.Alternative[]): boolean => branches.every(b => b.pattern.type === "List"),
};

/** Extractors for pattern structure. */
const Extract = {
	litToBranch: (lit: Lit.Literal): string => Lit.display(lit),

	binderName: (p: EB.Pattern): string =>
		match(p)
			.with(Patterns.Pats.Binder, ({ value }) => value)
			.with(Patterns.Pats.Wildcard, () => "_")
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

	structFields: (row: R.Row<EB.Pattern, string>): Array<{ label: string; pattern: EB.Pattern }> => Extract.structFieldsAcc(row, []),

	structFieldsAcc: (r: R.Row<EB.Pattern, string>, acc: Array<{ label: string; pattern: EB.Pattern }>): Array<{ label: string; pattern: EB.Pattern }> =>
		match(r)
			.with({ type: "extension" }, ({ label, value, row: rest }) => Extract.structFieldsAcc(rest, [...acc, { label, pattern: value }]))
			.otherwise(() => acc),
};

/** Collect values in source order (first occurrence). */
const InOrder = {
	variantTags: (branches: VariantBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const tag = b.pattern.row.label;
			return acc.includes(tag) ? acc : [...acc, tag];
		}, [] as string[]),

	litValues: (branches: LitBranch[]): string[] =>
		branches.reduce((acc, b) => {
			const val = Extract.litToBranch(b.pattern.value);
			return acc.includes(val) ? acc : [...acc, val];
		}, [] as string[]),
};

/** Project struct branches onto the pattern at the given label (column projection). */
const project = (label: string, branches: StructBranch[]): EB.Alternative[] =>
	branches.map(b => {
		const rFields = Extract.structFields(b.pattern.row);
		const first = rFields.find(f => f.label === label);
		return { pattern: first?.pattern ?? EB.Constructors.Patterns.Wildcard(), term: b.term, binders: b.binders };
	});

/** Branch filters by pattern type. */
const Branches = {
	variant: (branches: EB.Alternative[]): VariantBranch[] => branches.filter((b): b is VariantBranch => b.pattern.type === "Variant"),
	struct: (branches: EB.Alternative[]): StructBranch[] => branches.filter((b): b is StructBranch => b.pattern.type === "Struct"),
	lit: (branches: EB.Alternative[]): LitBranch[] => branches.filter((b): b is LitBranch => b.pattern.type === "Lit"),
	variable: (branches: EB.Alternative[]): VariableBranch[] => branches.filter((b): b is VariableBranch => Pats.isVariable(b.pattern)),
};

/** Build variable/default block and default case. */
const Blocks = {
	variableDefault: (branch: VariableBranch, scrutVar: string, mergeLabel: string, env: CompileEnv): { block: MIR.Block; defaultCase: DefaultCase } => {
		const defLabel = env.ctx.nextLabel();
		const overrides = overridesFor(scrutVar, env);
		const innerCtx = bind(env.ctx, Extract.binderName(branch.pattern), overrides);
		const bodyResult = env.lower(branch.term, innerCtx);
		const block = MIR.Constructors.Block(defLabel, [], bodyResult.instrs, MIR.Constructors.Terminator.Jump(mergeLabel, [bodyResult.value]));
		return { block, defaultCase: { target: defLabel, args: [] } };
	},

	failDefault: (failLabel: string): DefaultCase => ({ target: failLabel, args: [] }),
};

/** Compile variable rule: bind scrutinee and lower body. */
const ruleVariable = (branches: VariableBranch[], scrutVar: string, env: CompileEnv): CompileResult => {
	const branch = branches[0];
	const overrides = overridesFor(scrutVar, env);
	const xtended = bind(env.ctx, Extract.binderName(branch.pattern), overrides);
	const bodyResult = env.lower(branch.term, xtended);
	return {
		blocks: [],
		entry: {
			label: env.mergeLabel,
			instrs: bodyResult.instrs,
			terminator: MIR.Constructors.Terminator.Jump(env.mergeLabel, [bodyResult.value]),
		},
	};
};

/** Compile Variant rule (all branches variant) or Variant + variable mixture. */
const ruleVariant = (branches: VariantBranch[], scrutVar: string, env: CompileEnv, variableBranches: VariableBranch[]): CompileResult => {
	const tags = InOrder.variantTags(branches);

	const { cases, caseBlocks } = tags.reduce<{ cases: Case[]; caseBlocks: MIR.Block[] }>(
		(acc, tag) => {
			const matchingBranches = branches.filter(b => b.pattern.row.label === tag);
			const payloadBranches: EB.Alternative[] = matchingBranches.map(b => ({
				pattern: Extract.variantPayload(b.pattern.row),
				term: b.term,
				binders: b.binders,
			}));

			const caseLabel = env.ctx.nextLabel();
			const scrutParam = env.ctx.nextVar("scrut");
			const payloadVar = env.ctx.nextVar();
			const sub = compileMatrix(payloadVar, payloadBranches, env.mergeLabel, env.failLabel, env.ctx, env.lower);
			const blockInstrs: MIR.Instr[] = [MIR.Constructors.Instr.Read(tag, scrutParam, payloadVar), ...sub.entry.instrs];
			const block = MIR.Constructors.Block(caseLabel, [scrutParam], blockInstrs, sub.entry.terminator);

			return {
				cases: [...acc.cases, { value: tag, target: caseLabel, args: [scrutVar] }],
				caseBlocks: [...acc.caseBlocks, block, ...sub.blocks],
			};
		},
		{ cases: [], caseBlocks: [] },
	);

	const defaultCase: DefaultCase =
		variableBranches.length > 0
			? (() => {
					const { block, defaultCase: dc } = Blocks.variableDefault(variableBranches[0], scrutVar, env.mergeLabel, env);
					caseBlocks.push(block);
					return dc;
				})()
			: Blocks.failDefault(env.failLabel);

	const tagVar = env.ctx.nextVar();
	const entryBlock = MIR.Constructors.Block(
		env.ctx.nextLabel(),
		[],
		[MIR.Constructors.Instr.Read(TAG_FIELD, scrutVar, tagVar)],
		MIR.Constructors.Terminator.Branch(tagVar, cases, defaultCase),
	);

	return {
		blocks: [entryBlock, ...caseBlocks],
		entry: { label: entryBlock.label, instrs: [], terminator: MIR.Constructors.Terminator.Jump(entryBlock.label, []) },
	};
};

/** Compile Lit rule (all branches lit) or Lit + variable mixture. */
const ruleLit = (branches: LitBranch[], scrutVar: string, env: CompileEnv, variableBranches: VariableBranch[]): CompileResult => {
	const vals = InOrder.litValues(branches);

	const { cases, caseBlocks } = vals.reduce<{ cases: Case[]; caseBlocks: MIR.Block[] }>(
		(acc, val) => {
			const matchingBranch = branches.find(b => Extract.litToBranch(b.pattern.value) === val);

			if (!matchingBranch) {
				return acc;
			}
			const innerCtx = env.columnBindings ? { ...env.ctx, bound: new Map([...env.ctx.bound, ...overridesForLit(env)]) } : env.ctx;
			const bodyResult = env.lower(matchingBranch.term, innerCtx);
			const caseLabel = env.ctx.nextLabel();
			const block = MIR.Constructors.Block(caseLabel, [], bodyResult.instrs, MIR.Constructors.Terminator.Jump(env.mergeLabel, [bodyResult.value]));
			return {
				cases: [...acc.cases, { value: val, target: caseLabel, args: [] }],
				caseBlocks: [...acc.caseBlocks, block],
			};
		},
		{ cases: [], caseBlocks: [] },
	);

	const defaultCase: DefaultCase =
		variableBranches.length > 0
			? (() => {
					const { block, defaultCase: dc } = Blocks.variableDefault(variableBranches[0], scrutVar, env.mergeLabel, env);
					caseBlocks.push(block);
					return dc;
				})()
			: Blocks.failDefault(env.failLabel);

	const entryBlock = MIR.Constructors.Block(env.ctx.nextLabel(), [], [], MIR.Constructors.Terminator.Branch(scrutVar, cases, defaultCase));

	return {
		blocks: [entryBlock, ...caseBlocks],
		entry: { label: entryBlock.label, instrs: [], terminator: MIR.Constructors.Terminator.Jump(entryBlock.label, []) },
	};
};

/** Compile Struct rule (all branches struct) or Struct + variable mixture. */
const ruleStruct = (branches: StructBranch[], scrutVar: string, env: CompileEnv, variableBranches: VariableBranch[]): CompileResult => {
	const firstBranch = branches[0];
	const fields = Extract.structFields(firstBranch.pattern.row);

	if (fields.length === 0) {
		const bodyResult = env.lower(firstBranch.term, env.ctx);
		return {
			blocks: [],
			entry: {
				label: env.mergeLabel,
				instrs: bodyResult.instrs,
				terminator: MIR.Constructors.Terminator.Jump(env.mergeLabel, [bodyResult.value]),
			},
		};
	}

	const { readInstrs, fieldVars } = fields.reduce<{ readInstrs: MIR.Instr[]; fieldVars: Record<string, string> }>(
		(acc, { label }) => {
			const v = env.ctx.nextVar();
			return {
				readInstrs: [...acc.readInstrs, MIR.Constructors.Instr.Read(label, scrutVar, v)],
				fieldVars: { ...acc.fieldVars, [label]: v },
			};
		},
		{ readInstrs: [], fieldVars: {} },
	);

	const firstLabel = fields[0].label;
	const field0Var = fieldVars[firstLabel];
	const column = project(firstLabel, branches);

	const columnBindings = fields.length > 1 ? new Map(fields.slice(1).map((f, i) => [i + 1, fieldVars[f.label]])) : undefined;

	if (Pats.allVariable(column)) {
		const branch = branches[0];
		const structEnv: CompileEnv = columnBindings ? { ...env, columnBindings } : env;
		const overrides = overridesFor(field0Var, structEnv);
		const innerCtx = bind(env.ctx, Extract.binderName(column[0].pattern), overrides);
		const bodyResult = env.lower(branch.term, innerCtx);
		return {
			blocks: [],
			entry: {
				label: env.mergeLabel,
				instrs: [...readInstrs, ...bodyResult.instrs],
				terminator: MIR.Constructors.Terminator.Jump(env.mergeLabel, [bodyResult.value]),
			},
		};
	}

	const failLabel = variableBranches.length > 0 ? env.ctx.nextLabel() : env.failLabel;
	const variableBlocks: MIR.Block[] = [];
	const actualFailLabel =
		variableBranches.length > 0
			? (() => {
					const { block } = Blocks.variableDefault(variableBranches[0], scrutVar, env.mergeLabel, env);
					variableBlocks.push(block);
					return block.label;
				})()
			: env.failLabel;

	const sub = compileMatrix(field0Var, column, env.mergeLabel, actualFailLabel, env.ctx, env.lower, columnBindings ? { columnBindings } : undefined);

	const entryBlock = MIR.Constructors.Block(env.ctx.nextLabel(), [scrutVar], [...readInstrs, ...sub.entry.instrs], sub.entry.terminator);

	return {
		blocks: [entryBlock, ...sub.blocks, ...variableBlocks],
		entry: { label: entryBlock.label, instrs: [], terminator: MIR.Constructors.Terminator.Jump(entryBlock.label, [scrutVar]) },
	};
};

/** Compile clause matrix to decision tree (Maranget-style). */
function compileMatrix(
	scrutVar: string,
	branches: EB.Alternative[],
	mergeLabel: string,
	failLabel: string,
	ctx: LowerCtx,
	lower: (t: EB.Term, c: LowerCtx) => LowerResult,
	envOverrides?: Partial<CompileEnv>,
): CompileResult {
	const env: CompileEnv = { scrutVar, mergeLabel, failLabel, ctx, lower, ...envOverrides };

	if (branches.length === 0) {
		return {
			blocks: [],
			entry: { label: failLabel, instrs: [], terminator: MIR.Constructors.Terminator.Jump(failLabel, []) },
		};
	}

	const variableBranches = Branches.variable(branches);

	return match(branches)
		.when(Pats.allVariable, () => ruleVariable(Branches.variable(branches), scrutVar, env))
		.when(Pats.allVariant, () => ruleVariant(Branches.variant(branches), scrutVar, env, variableBranches))
		.when(Pats.allLit, () => ruleLit(Branches.lit(branches), scrutVar, env, variableBranches))
		.when(Pats.allStruct, () => ruleStruct(Branches.struct(branches), scrutVar, env, variableBranches))
		.when(Pats.allList, () => {
			throw new Error("Match lowering: List pattern not yet implemented");
		})
		.when(
			() => Branches.variant(branches).length > 0,
			() => ruleVariant(Branches.variant(branches), scrutVar, env, variableBranches),
		)
		.when(
			() => Branches.struct(branches).length > 0 && variableBranches.length > 0,
			() => ruleStruct(Branches.struct(branches), scrutVar, env, variableBranches),
		)
		.when(
			() => Branches.lit(branches).length > 0,
			() => ruleLit(Branches.lit(branches), scrutVar, env, variableBranches),
		)
		.otherwise(() => {
			throw new Error(`Match lowering: unsupported pattern mix`);
		});
}

/** Lower match when scrutinee is already lowered (for worklist integration). */
export const lowerMatchFromScrut = (
	scrutResult: LowerResult,
	alternatives: EB.Alternative[],
	ctx: LowerCtx,
	lower: (t: EB.Term, c: LowerCtx) => LowerResult,
): LowerResult => {
	const mergeLabel = ctx.nextLabel();
	const mergeParam = ctx.nextVar();
	const failLabel = ctx.nextLabel();

	const compiled = compileMatrix(scrutResult.value, alternatives, mergeLabel, failLabel, ctx, lower);

	const mergeBlock = MIR.Constructors.Block(mergeLabel, [mergeParam], [], MIR.Constructors.Terminator.Return(mergeParam));

	const failBlock = MIR.Constructors.Block(
		failLabel,
		[],
		[MIR.Constructors.Instr.Let("__match_fail", MIR.Constructors.Expr.Lit(Lit.String("non-exhaustive match")))],
		MIR.Constructors.Terminator.Return("__match_fail"),
	);

	const entryBlock = MIR.Constructors.Block(
		"entry",
		[],
		[...scrutResult.instrs, ...compiled.entry.instrs],
		compiled.entry.terminator.type === "Jump" && compiled.entry.terminator.target === compiled.entry.label
			? MIR.Constructors.Terminator.Jump(compiled.entry.label, [])
			: compiled.entry.terminator,
	);

	return {
		instrs: [],
		value: mergeParam,
		functions: scrutResult.functions,
		blocks: [entryBlock, ...compiled.blocks, mergeBlock, failBlock],
		entry: "entry",
	};
};

export const lowerMatch = (scrutinee: EB.Term, alternatives: EB.Alternative[], ctx: LowerCtx, lower: (t: EB.Term, c: LowerCtx) => LowerResult): LowerResult =>
	lowerMatchFromScrut(lower(scrutinee, ctx), alternatives, ctx, lower);
