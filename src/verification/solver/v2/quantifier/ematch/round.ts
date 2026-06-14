/* eslint-disable @typescript-eslint/no-namespace */
// E-matching rounds instantiate triggered quantifiers and stage generated CDCL lemmas.
// CDCL = Conflict-Driven Clause Learning; EUF = Equality with Uninterpreted Functions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md

import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import type { Literal } from "../../cdcl";
import type { Arena, Enode } from "../../euf";
import { State as State_ } from "../model";
import type { Info, Lemma, State } from "../model";
import * as Triggers from "../triggers";
import * as Matching from "./matching";
import type { Substitution } from "./matching";

export const create = (formula: IVL.Formula): State => State_.from(Triggers.extract(formula));

export const round = (state: State, arena: Arena.State, find: Matching.Find, next: Next, encode: Encode): Result =>
	match(state.generation >= MAX_GENERATION)
		.with(true, () => ({ state, lemmas: [] }))
		.with(false, () => instantiate(state, arena, find, next, encode))
		.exhaustive();

export type Next = () => number;

export type Encode = (formula: IVL.Formula) => Literal[];

export type Result = {
	lemmas: Lemma[];
	state: State;
};

const MAX_GENERATION = 5;

const instantiate = (state: State, arena: Arena.State, find: Matching.Find, next: Next, encode: Encode): Result => {
	const initial: Accumulator = { lemmas: [], instantiated: new Set(state.instantiated) };
	const result = state.quantifiers.reduce((acc, q) => quantifier(acc, q, state.generation, arena, find, next, encode), initial);
	const nextState = {
		...state,
		generation: state.generation + 1,
		instantiated: result.instantiated,
		phase: { round: state.phase.round + 1, pending: result.lemmas },
	};
	return { lemmas: result.lemmas, state: nextState };
};

type Accumulator = {
	readonly lemmas: Lemma[];
	readonly instantiated: Set<string>;
};

const quantifier = (acc: Accumulator, info: Info, generation: number, arena: Arena.State, find: Matching.Find, next: Next, encode: Encode): Accumulator =>
	info.triggers.reduce(
		(state, trigger) =>
			Matching.multi(trigger.terms, arena, find).substitutions.reduce((subState, sub) => instance(subState, info, sub, generation, arena, next, encode), state),
		acc,
	);

const instance = (acc: Accumulator, info: Info, sub: Substitution, generation: number, arena: Arena.State, next: Next, encode: Encode): Accumulator =>
	match(acc.instantiated.has(key(info, sub)))
		.with(true, () => acc)
		.with(false, () => {
			const id = key(info, sub);
			const grounded = Formula.substitute(info.body, terms(info.binders, sub, arena));
			const literals = encode(grounded);
			return match(literals)
				.with([], () => ({ ...acc, instantiated: new Set([...acc.instantiated, id]) }))
				.otherwise(ls => ({
					lemmas: [...acc.lemmas, lemma(info, generation, next, ls)],
					instantiated: new Set([...acc.instantiated, id]),
				}));
		})
		.exhaustive();

const key = (info: Info, sub: Substitution): string => `${info.origin ?? "q"}[${info.binders.map(b => `${b.name}=${sub.get(b.name) ?? "?"}`).join(",")}]`;

const terms = (binders: readonly IVL.Binder[], sub: Substitution, arena: Arena.State): ReadonlyMap<string, IVL.Term> =>
	binders.reduce<ReadonlyMap<string, IVL.Term>>(
		(acc, binder) =>
			match(sub.get(binder.name))
				.with(undefined, () => acc)
				.otherwise(id =>
					match(arena.nodes.get(id))
						.with(undefined, () => acc)
						.otherwise(node => new Map([...acc, [binder.name, Term.of(node, arena)]])),
				),
		new Map(),
	);

const lemma = (info: Info, generation: number, next: Next, literals: readonly Literal[]): Lemma => ({
	clause: {
		id: next(),
		literals: [...literals],
		origin: `quantifier:${info.origin ?? "forall"}:gen${generation}`,
	},
	origin: info.origin ?? "forall",
	generation,
	source: { tag: "ematch" },
});

namespace Formula {
	export const substitute = (formula: IVL.Formula, replacements: ReadonlyMap<string, IVL.Term>): IVL.Formula =>
		match(formula)
			.with(Patterns.Formula.Atom, ({ op, args, origin }) =>
				Build.atom(op, Term.substitute(args[0], replacements), Term.substitute(args[1], replacements), origin),
			)
			.with(Patterns.Formula.And, ({ values, origin }) =>
				Build.andWithOrigin(
					values.map(f => substitute(f, replacements)),
					origin,
				),
			)
			.with(Patterns.Formula.Or, ({ values, origin }) =>
				Build.orWithOrigin(
					values.map(f => substitute(f, replacements)),
					origin,
				),
			)
			.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(substitute(value, replacements), origin))
			.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(substitute(left, replacements), substitute(right, replacements), origin))
			.with(Patterns.Formula.Forall, f => f)
			.with(Patterns.Formula.Exists, f => f)
			.with(Patterns.Formula.True, f => f)
			.with(Patterns.Formula.False, f => f)
			.exhaustive();
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

	export const substitute = (term: IVL.Term, replacements: ReadonlyMap<string, IVL.Term>): IVL.Term =>
		match(term)
			.with(Patterns.Term.Var, ({ name, sort }) => replacements.get(name) ?? Build.var_(name, sort))
			.with(Patterns.Term.App, ({ head, args, sort }) =>
				Build.app(
					head,
					args.map(t => substitute(t, replacements)),
					sort,
				),
			)
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Build.arith(op, substitute(args[0], replacements), substitute(args[1], replacements), sort))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Build.select(substitute(array, replacements), substitute(index, replacements), sort))
			.otherwise(t => t);
}
