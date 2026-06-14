// E-matching matches trigger terms against interned EUF enodes modulo representative equality.
// EUF = Equality with Uninterpreted Functions.

import { match, P } from "ts-pattern";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import type { Arena, Enode } from "../../euf";

export const single = (pattern: IVL.Term, arena: Arena.State, find: Find): Result => ({
	substitutions: Array.from(arena.nodes.values())
		.map(node => term(pattern, node.id, arena, find, new Map()))
		.filter((sub): sub is Substitution => !!sub),
});

export const multi = (patterns: readonly IVL.Term[], arena: Arena.State, find: Find): Result =>
	match(patterns)
		.with([], () => ({ substitutions: [] }))
		.with([P.select()], pattern => single(pattern, arena, find))
		.otherwise(([pattern, ...rest]) => ({
			substitutions: single(pattern, arena, find).substitutions.flatMap(sub =>
				rest.reduce<readonly Substitution[]>((acc, p) => acc.flatMap(s => extend(p, arena, find, s)), [sub]),
			),
		}));

export type Find = (id: Enode.Id) => Enode.Id;

export type Result = {
	readonly substitutions: readonly Substitution[];
};

export type Substitution = ReadonlyMap<string, Enode.Id>;

const term = (pattern: IVL.Term, target: Enode.Id, arena: Arena.State, find: Find, current: Substitution): Substitution | undefined =>
	match(pattern)
		.with(Patterns.Term.Var, ({ name }) => variable(name, target, find, current))
		.with(Patterns.Term.App, ({ head, args }) =>
			match(arena.nodes.get(target))
				.with({ head, args: P.when(ids => ids.length === args.length) }, node => args.reduce(step(arena, find, node), copy(current)))
				.otherwise(() => undefined),
		)
		.with(Patterns.Term.Const, ({ name }) =>
			match(arena.nodes.get(target))
				.with({ head: name, args: [] }, () => copy(current))
				.otherwise(() => undefined),
		)
		.with(Patterns.Term.Num, ({ value }) =>
			match(arena.nodes.get(target))
				.with({ head: value, args: [] }, () => copy(current))
				.otherwise(() => undefined),
		)
		.otherwise(() => undefined);

const extend = (pattern: IVL.Term, arena: Arena.State, find: Find, current: Substitution): readonly Substitution[] =>
	Array.from(arena.nodes.values())
		.map(node => term(pattern, node.id, arena, find, current))
		.filter((sub): sub is Substitution => !!sub);

const variable = (name: string, target: Enode.Id, find: Find, current: Substitution): Substitution | undefined =>
	match(current.get(name))
		.with(P.number, existing =>
			match(find(existing) === find(target))
				.with(true, () => copy(current))
				.with(false, () => undefined)
				.exhaustive(),
		)
		.with(undefined, () => new Map([...current, [name, target]]))
		.exhaustive();

const step =
	(arena: Arena.State, find: Find, node: Enode.T) =>
	(acc: Substitution | undefined, pattern: IVL.Term, index: number): Substitution | undefined =>
		match(acc)
			.with(undefined, () => undefined)
			.otherwise(sub => term(pattern, node.args[index], arena, find, sub));

const copy = (sub: Substitution): Substitution => new Map([...sub]);
