// E-matching matches trigger terms against interned EUF enodes modulo representative equality.
// EUF = Equality with Uninterpreted Functions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md

import { match, P } from "ts-pattern";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import * as Core from "../../core";
import * as EUF from "../../euf";
import type { Enode } from "../../euf";

export const multi = function* (patterns: readonly IVL.Term[]): Core.G<Result> {
	const state = yield* Core.State.get();
	return many(patterns, context(state));
};

export const single = function* (pattern: IVL.Term): Core.G<Result> {
	const state = yield* Core.State.get();
	return one(pattern, context(state));
};

export type Result = {
	readonly substitutions: readonly Substitution[];
};

export type Substitution = ReadonlyMap<string, Enode.Id>;

type Context = {
	readonly arena: EUF.Arena.State;
	readonly euf: EUF.CC.State;
};

const context = (state: Core.State): Context => ({
	arena: state.arena,
	euf: state.theories.euf,
});

const many = (patterns: readonly IVL.Term[], ctx: Context): Result =>
	match(patterns)
		.with([], () => ({ substitutions: [] }))
		.with([P.select()], pattern => one(pattern, ctx))
		.otherwise(([pattern, ...rest]) => ({
			substitutions: one(pattern, ctx).substitutions.flatMap(sub =>
				rest.reduce<readonly Substitution[]>((acc, p) => acc.flatMap(s => extend(p, ctx, s)), [sub]),
			),
		}));

const one = (pattern: IVL.Term, ctx: Context): Result => ({
	substitutions: Array.from(ctx.arena.nodes.values())
		.map(node => term(pattern, node.id, ctx, new Map()))
		.filter((sub): sub is Substitution => !!sub),
});

const term = (pattern: IVL.Term, target: Enode.Id, ctx: Context, current: Substitution): Substitution | undefined =>
	match(pattern)
		.with(Patterns.Term.Var, ({ name }) => variable(name, target, ctx, current))
		.with(Patterns.Term.App, ({ head, args }) =>
			match(ctx.arena.nodes.get(target))
				.with({ head, args: P.when(ids => ids.length === args.length) }, node => args.reduce(step(ctx, node), copy(current)))
				.otherwise(() => undefined),
		)
		.with(Patterns.Term.Const, ({ name }) =>
			match(ctx.arena.nodes.get(target))
				.with({ head: name, args: [] }, () => copy(current))
				.otherwise(() => undefined),
		)
		.with(Patterns.Term.Num, ({ value }) =>
			match(ctx.arena.nodes.get(target))
				.with({ head: value, args: [] }, () => copy(current))
				.otherwise(() => undefined),
		)
		.otherwise(() => undefined);

const extend = (pattern: IVL.Term, ctx: Context, current: Substitution): readonly Substitution[] =>
	Array.from(ctx.arena.nodes.values())
		.map(node => term(pattern, node.id, ctx, current))
		.filter((sub): sub is Substitution => !!sub);

const variable = (name: string, target: Enode.Id, ctx: Context, current: Substitution): Substitution | undefined =>
	match(current.get(name))
		.with(P.number, existing =>
			match(EUF.CC.find(ctx.euf, existing) === EUF.CC.find(ctx.euf, target))
				.with(true, () => copy(current))
				.with(false, () => undefined)
				.exhaustive(),
		)
		.with(undefined, () => new Map([...current, [name, target]]))
		.exhaustive();

const step =
	(ctx: Context, node: Enode.T) =>
	(acc: Substitution | undefined, pattern: IVL.Term, index: number): Substitution | undefined =>
		match(acc)
			.with(undefined, () => undefined)
			.otherwise(sub => term(pattern, node.args[index], ctx, sub));

const copy = (sub: Substitution): Substitution => new Map([...sub]);
