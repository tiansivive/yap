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
import * as Core from "../../core";
import { Lookup } from "../../encoding";
import type { Enode } from "../../euf";
import * as Trace from "../../trace";
import { State as State_ } from "../model";
import type { Info, Lemma, State, Trigger } from "../model";
import * as Triggers from "../triggers";
import * as Matching from "./matching";
import type { Substitution } from "./matching";

const MAX_GENERATION = 5;

export const round = function* (): Core.G<Result> {
	const state = yield* Core.State.get();
	const result = yield* match(state.quantifiers.generation >= MAX_GENERATION)
		.with(true, () => Core.lift({ lemmas: [] }))
		.with(false, () => instantiate())
		.exhaustive();
	yield* Trace.emit({ tag: "round", round: state.quantifiers.phase.round, lemmas: result.lemmas.length });
	return result;
};

export const create = (formula: IVL.Formula): State => State_.from(Triggers.extract(formula));

export type Result = {
	lemmas: Lemma[];
};

const instantiate = function* (): Core.G<Result> {
	const state = yield* Core.State.get();
	const initial: Accumulator = { lemmas: [], instantiated: new Set(state.quantifiers.instantiated) };
	const result = yield* quantifiers(initial, state.quantifiers.quantifiers);
	return yield* match(result.lemmas)
		.with([], () => Core.lift({ lemmas: [] }))
		.otherwise(function* (lemmas): Core.G<Result> {
			yield* Core.State.modify(s => ({
				...s,
				quantifiers: {
					...s.quantifiers,
					generation: s.quantifiers.generation + 1,
					instantiated: new Set([...s.quantifiers.instantiated, ...result.instantiated]),
					phase: { round: s.quantifiers.phase.round + 1, pending: lemmas },
				},
			}));
			return { lemmas };
		});
};

type Accumulator = {
	readonly lemmas: Lemma[];
	readonly instantiated: Set<string>;
};

const quantifiers = (acc: Accumulator, infos: readonly Info[]): Core.G<Accumulator> =>
	match(infos)
		.with([], () => Core.lift(acc))
		.otherwise(function* ([info, ...rest]): Core.G<Accumulator> {
			const next = yield* quantifier(acc, info);
			return yield* quantifiers(next, rest);
		});

const quantifier = (acc: Accumulator, info: Info): Core.G<Accumulator> => triggers(acc, info, info.triggers);

const triggers = (acc: Accumulator, info: Info, all: readonly Trigger[]): Core.G<Accumulator> =>
	match(all)
		.with([], () => Core.lift(acc))
		.otherwise(function* ([trigger, ...rest]): Core.G<Accumulator> {
			const result = yield* Matching.multi(trigger.terms);
			const next = yield* substitutions(acc, info, result.substitutions);
			return yield* triggers(next, info, rest);
		});

const substitutions = (acc: Accumulator, info: Info, all: readonly Substitution[]): Core.G<Accumulator> =>
	match(all)
		.with([], () => Core.lift(acc))
		.otherwise(function* ([sub, ...rest]): Core.G<Accumulator> {
			const next = yield* instance(acc, info, sub);
			return yield* substitutions(next, info, rest);
		});

const instance = function* (acc: Accumulator, info: Info, sub: Substitution): Core.G<Accumulator> {
	const state = yield* Core.State.get();
	return yield* Core.lift(
		match(acc.instantiated.has(key(info, sub)))
			.with(true, () => acc)
			.with(false, () => {
				const id = key(info, sub);
				const grounded = Formula.substitute(info.body, terms(info.binders, sub, state));
				const literals = Lookup.literals(state.encoding, grounded);
				return match(literals)
					.with([], () => ({ ...acc, instantiated: new Set([...acc.instantiated, id]) }))
					.otherwise(ls => ({
						lemmas: [...acc.lemmas, lemma(info, state.quantifiers.generation, ls)],
						instantiated: new Set([...acc.instantiated, id]),
					}));
			})
			.exhaustive(),
	);
};

const key = (info: Info, sub: Substitution): string => `${info.origin ?? "q"}[${info.binders.map(b => `${b.name}=${sub.get(b.name) ?? "?"}`).join(",")}]`;

const terms = (binders: readonly IVL.Binder[], sub: Substitution, state: Core.State): ReadonlyMap<string, IVL.Term> =>
	binders.reduce<ReadonlyMap<string, IVL.Term>>(
		(acc, binder) =>
			match(sub.get(binder.name))
				.with(undefined, () => acc)
				.otherwise(id =>
					match(state.arena.nodes.get(id))
						.with(undefined, () => acc)
						.otherwise(node => new Map([...acc, [binder.name, Term.of(node, state)]])),
				),
		new Map(),
	);

const lemma = (info: Info, generation: number, literals: readonly Literal[]): Lemma => ({
	clause: {
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
	export const of = (node: Enode.T, state: Core.State): IVL.Term =>
		match(node.args)
			.with([], () => Build.const_(node.head, node.sort))
			.otherwise(args =>
				Build.app(
					node.head,
					args.map(id =>
						match(state.arena.nodes.get(id))
							.with(undefined, () => Build.const_(`?${id}`, node.sort))
							.otherwise(arg => of(arg, state)),
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
