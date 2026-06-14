/* eslint-disable @typescript-eslint/no-namespace */
// Universe builds the bounded ground-term domain MBQI ranges over for candidate instantiation.
// MBQI = Model-Based Quantifier Instantiation; EUF = Equality with Uninterpreted Functions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md

import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import type { Arena, Enode } from "../../euf";
import type { Info } from "../model";

export const from = (arena: Arena.State, quantifiers: Info[]): Universe => merge(nodes(arena), infos(quantifiers));

export type Universe = Map<string, IVL.Term[]>;

export const sort = (s: IVL.Sort): string => sort_(s);

const sort_ = (s: IVL.Sort): string =>
	match(s)
		.with(Patterns.Sort.Bool, () => "Bool")
		.with(Patterns.Sort.Int, () => "Num")
		.with(Patterns.Sort.Real, () => "Num")
		.with(Patterns.Sort.String, () => "String")
		.with(Patterns.Sort.Unit, () => "Unit")
		.with(Patterns.Sort.Row, () => "Row")
		.with(Patterns.Sort.Fn, ({ args, ret }) => `Fn(${args.map(sort_).join(",")}->${sort_(ret)})`)
		.with(Patterns.Sort.Uninterpreted, ({ name }) => `U:${name}`)
		.exhaustive();

export const key = (term: IVL.Term): string =>
	match(term)
		.with(Patterns.Term.Num, ({ value }) => `num:${value}`)
		.with(Patterns.Term.Const, ({ name }) => `const:${name}`)
		.with(Patterns.Term.Bool, ({ value }) => `bool:${value}`)
		.with(Patterns.Term.Str, ({ value }) => `str:${value}`)
		.otherwise(t => JSON.stringify(t));

export const string = (term: IVL.Term): string =>
	match(term)
		.with(Patterns.Term.Num, ({ value }) => value)
		.with(Patterns.Term.Const, ({ name }) => name)
		.with(Patterns.Term.Bool, ({ value }) => String(value))
		.with(Patterns.Term.Str, ({ value }) => `"${value}"`)
		.otherwise(() => "?");

const LIMIT = 10;

const merge = (a: Universe, b: Universe): Universe =>
	[...new Set([...a.keys(), ...b.keys()])].reduce<Universe>(
		(acc, s) => new Map([...acc, [s, dedupe([...(a.get(s) ?? []), ...(b.get(s) ?? [])]).slice(0, LIMIT)]]),
		new Map(),
	);

const nodes = (arena: Arena.State): Universe => [...arena.nodes.values()].reduce<Universe>((acc, node) => add(acc, Term.of(node, arena)), new Map());

const infos = (quantifiers: Info[]): Universe =>
	quantifiers.flatMap(info => Formula.terms(info.body, new Set(info.binders.map(b => b.name)))).reduce<Universe>((acc, term) => add(acc, term), new Map());

const add = (universe: Universe, term: IVL.Term): Universe => {
	const s = Term.sort(term);
	const terms = universe.get(s) ?? [];
	return new Map([...universe, [s, dedupe([...terms, term])]]);
};

const dedupe = (terms: IVL.Term[]): IVL.Term[] =>
	terms.reduce<{ seen: Set<string>; result: IVL.Term[] }>(
		(acc, term) =>
			match(acc.seen.has(key(term)))
				.with(true, () => acc)
				.with(false, () => ({ seen: new Set([...acc.seen, key(term)]), result: [...acc.result, term] }))
				.exhaustive(),
		{ seen: new Set(), result: [] },
	).result;

namespace Formula {
	export const terms = (formula: IVL.Formula, bound: ReadonlySet<string>): readonly IVL.Term[] =>
		match(formula)
			.with(Patterns.Formula.Atom, ({ args }) => args.flatMap(term => Term.ground(term, bound)))
			.with(Patterns.Formula.And, ({ values }) => values.flatMap(f => terms(f, bound)))
			.with(Patterns.Formula.Or, ({ values }) => values.flatMap(f => terms(f, bound)))
			.with(Patterns.Formula.Not, ({ value }) => terms(value, bound))
			.with(Patterns.Formula.Implies, ({ left, right }) => [...terms(left, bound), ...terms(right, bound)])
			.with(Patterns.Formula.Forall, ({ binders, body }) => terms(body, new Set([...bound, ...binders.map(b => b.name)])))
			.with(Patterns.Formula.Exists, ({ binders, body }) => terms(body, new Set([...bound, ...binders.map(b => b.name)])))
			.otherwise(() => []);
}

namespace Term {
	export const of = (node: Enode.T, arena: Arena.State): IVL.Term =>
		match(node.args)
			.with([], () => Build.const_(node.head, node.sort))
			.otherwise(args =>
				Build.app(
					node.head,
					args.map(id =>
						match(arena.nodes.get(id))
							.with(undefined, () => Build.const_(`?${id}`, node.sort))
							.otherwise(arg => of(arg, arena)),
					),
					node.sort,
				),
			);

	export const sort = (term: IVL.Term): string =>
		match(term)
			.with(Patterns.Term.Num, t => sort_(t.sort))
			.with(Patterns.Term.Const, t => sort_(t.sort))
			.with(Patterns.Term.Bool, () => "Bool")
			.with(Patterns.Term.Str, () => "String")
			.otherwise(() => "unknown");

	export const ground = (term: IVL.Term, bound: ReadonlySet<string>): readonly IVL.Term[] =>
		match(term)
			.with(Patterns.Term.Var, ({ name }) =>
				match(bound.has(name))
					.with(true, () => [])
					.with(false, () => [term])
					.exhaustive(),
			)
			.with(Patterns.Term.Const, () => [term])
			.with(Patterns.Term.Num, () => [term])
			.with(Patterns.Term.Bool, () => [term])
			.with(Patterns.Term.Str, () => [term])
			.with(Patterns.Term.Arith, ({ args }) => args.flatMap(t => ground(t, bound)))
			.with(Patterns.Term.App, ({ args }) => args.flatMap(t => ground(t, bound)))
			.with(Patterns.Term.Select, ({ array, index }) => [...ground(array, bound), ...ground(index, bound)])
			.otherwise(() => []);
}
