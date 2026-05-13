import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "../mir";
import * as M from "../monad";
import * as C from "../context";
import { Patterns } from "../patterns";

const { Terminator: T } = MIR.Constructors;

export type VariableBranch = EB.Alternative & { pattern: { type: "Binder" } | { type: "Wildcard" } };
export type ColumnBindings = Map<number, C.Stamped>;

export const Pats = {
	isVariable: (p: EB.Pattern): boolean =>
		match(p)
			.with(Patterns.Pats.Binder, () => true)
			.with(Patterns.Pats.Wildcard, () => true)
			.otherwise(() => false),

	allVariable: (branches: EB.Alternative[]): boolean => branches.every(b => Pats.isVariable(b.pattern)),
};

export const filterVariable = (branches: EB.Alternative[]): VariableBranch[] => branches.filter((b): b is VariableBranch => Pats.isVariable(b.pattern));

export const binderName = (p: EB.Pattern): string =>
	match(p)
		.with(Patterns.Pats.Binder, ({ value }) => value)
		.otherwise(() => "_");

export const Conts = {
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

export function* pushVariableLeaf(
	scrutVar: C.Stamped,
	branch: VariableBranch,
	mergeLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<void> {
	const overrides = new Map<number, C.Stamped>(columnBindings ?? []);
	overrides.set(0, scrutVar);
	const altCtx = C.bind(ctx, C.stampNamed(binderName(branch.pattern)), overrides);

	yield* M.Worklist.push(Conts.sealFocus(mergeLabel));
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
}

export function* pushDefaultBranch(
	scrutVar: C.Stamped,
	branch: VariableBranch,
	mergeLabel: string,
	ctx: C.LowerCtx,
	columnBindings?: ColumnBindings,
): M.Glowering<string> {
	const defLabel = ctx.nextLabel("d");
	const overrides = new Map<number, C.Stamped>(columnBindings ?? []);
	overrides.set(0, scrutVar);
	const altCtx = C.bind(ctx, C.stampNamed(binderName(branch.pattern)), overrides);

	yield* M.Worklist.push(Conts.seal(defLabel, mergeLabel));
	yield* M.Worklist.push({ type: "Lower", ctx: altCtx, term: branch.term });
	yield* M.Worklist.push(Conts.open(defLabel));
	return defLabel;
}
