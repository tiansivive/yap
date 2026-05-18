// Quantifier round orchestration: between CDCL fixpoints, runs E-matching against
// the EUF arena to instantiate universally quantified formulas as ground lemmas.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md

import { match } from "ts-pattern";
import { IVL } from "../ivl/types";
import { Build } from "../ivl/build";
import type { Clause, Literal } from "../cdcl/core";
import type { ArenaState, EnodeId } from "../theories/euf/arena";
import { EMatch, type Substitution } from "./ematch";
import { Triggers, type QuantifierInfo } from "./triggers";

export type InstantiationLemma = {
	readonly clause: Clause;
	readonly origin: string;
	readonly generation: number;
};

export type QuantifierState = {
	readonly quantifiers: readonly QuantifierInfo[];
	readonly generation: number;
	readonly instantiated: ReadonlySet<string>;
};

const MAX_GENERATION = 5;

export const QuantifierEngine = {
	create: (formula: IVL.Formula): QuantifierState => ({
		quantifiers: Triggers.extract(formula),
		generation: 0,
		instantiated: new Set(),
	}),

	round: (
		state: QuantifierState,
		arena: ArenaState,
		find: (id: EnodeId) => EnodeId,
		nextClauseId: () => number,
		encodeLemma: (formula: IVL.Formula) => readonly Literal[],
	): { lemmas: readonly InstantiationLemma[]; state: QuantifierState } => {
		if (state.generation >= MAX_GENERATION) {
			return { lemmas: [], state };
		}

		const lemmas: InstantiationLemma[] = [];
		const newInstantiated = new Set(state.instantiated);

		state.quantifiers.forEach(qi => {
			qi.triggers.forEach(trigger => {
				const { substitutions } = EMatch.multi(trigger.terms, arena, find);

				substitutions.forEach(sub => {
					const key = instantiationKey(qi, sub);

					if (newInstantiated.has(key)) {
						return;
					}
					newInstantiated.add(key);

					const grounded = instantiateBody(qi.body, qi.binders, sub, arena);
					const literals = encodeLemma(grounded);

					if (literals.length === 0) {
						return;
					}

					lemmas.push({
						clause: {
							id: nextClauseId(),
							literals: [...literals],
							origin: `quantifier:${qi.origin ?? "forall"}:gen${state.generation}`,
						},
						origin: qi.origin ?? "forall",
						generation: state.generation,
					});
				});
			});
		});

		return {
			lemmas,
			state: {
				quantifiers: state.quantifiers,
				generation: state.generation + 1,
				instantiated: newInstantiated,
			},
		};
	},
};

const instantiationKey = (qi: QuantifierInfo, sub: Substitution): string => {
	const bindings = qi.binders.map(b => `${b.name}=${sub.get(b.name) ?? "?"}`).join(",");
	return `${qi.origin ?? "q"}[${bindings}]`;
};

const instantiateBody = (body: IVL.Formula, binders: readonly IVL.Binder[], sub: Substitution, arena: ArenaState): IVL.Formula => {
	const replacements = new Map<string, IVL.Term>();

	binders.forEach(b => {
		const nodeId = sub.get(b.name);

		if (nodeId === undefined) {
			return;
		}
		const node = arena.nodes.get(nodeId);

		if (!node) {
			return;
		}

		replacements.set(b.name, nodeToTerm(node, arena));
	});

	return substituteFormula(body, replacements);
};

const nodeToTerm = (node: { readonly head: string; readonly args: readonly EnodeId[]; readonly sort: IVL.Sort }, arena: ArenaState): IVL.Term => {
	if (node.args.length === 0) {
		return Build.const_(node.head, node.sort);
	}

	return Build.app(
		node.head,
		node.args.map(argId => {
			const argNode = arena.nodes.get(argId);
			return argNode ? nodeToTerm(argNode, arena) : Build.const_(`?${argId}`, node.sort);
		}),
		node.sort,
	);
};

const substituteFormula = (formula: IVL.Formula, replacements: ReadonlyMap<string, IVL.Term>): IVL.Formula =>
	match(formula)
		.with({ tag: "Atom" }, ({ op, args, origin }) => Build.atom(op, substituteTerm(args[0], replacements), substituteTerm(args[1], replacements), origin))
		.with({ tag: "And" }, ({ values, origin }) => ({
			tag: "And" as const,
			values: values.map(v => substituteFormula(v, replacements)),
			origin,
		}))
		.with({ tag: "Or" }, ({ values, origin }) => ({
			tag: "Or" as const,
			values: values.map(v => substituteFormula(v, replacements)),
			origin,
		}))
		.with({ tag: "Not" }, ({ value, origin }) => ({
			tag: "Not" as const,
			value: substituteFormula(value, replacements),
			origin,
		}))
		.with({ tag: "Implies" }, ({ left, right, origin }) => ({
			tag: "Implies" as const,
			left: substituteFormula(left, replacements),
			right: substituteFormula(right, replacements),
			origin,
		}))
		.with({ tag: "Forall" }, f => f)
		.with({ tag: "Exists" }, f => f)
		.with({ tag: "True" }, f => f)
		.with({ tag: "False" }, f => f)
		.exhaustive();

const substituteTerm = (term: IVL.Term, replacements: ReadonlyMap<string, IVL.Term>): IVL.Term =>
	match(term)
		.with({ tag: "Var" }, ({ name, sort }) => replacements.get(name) ?? Build.var_(name, sort))
		.with({ tag: "App" }, ({ head, args, sort }) =>
			Build.app(
				head,
				args.map(a => substituteTerm(a, replacements)),
				sort,
			),
		)
		.with({ tag: "Arith" }, ({ op, args, sort }) => Build.arith(op, substituteTerm(args[0], replacements), substituteTerm(args[1], replacements), sort))
		.with({ tag: "Select" }, ({ array, index, sort }) => Build.select(substituteTerm(array, replacements), substituteTerm(index, replacements), sort))
		.otherwise(t => t);
