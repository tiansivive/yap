// Model-Based Quantifier Instantiation: fallback for quantifiers without E-matching triggers.
// Enumerates ground terms by sort from the EUF arena AND quantifier bodies to generate instantiations.
// MBQI = Model-Based Quantifier Instantiation; EUF = Equality with Uninterpreted Functions
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md
// Reference: Ge & de Moura, "Complete Instantiation for Quantified Formulas in SMT" (CAV 2009)

import { match } from "ts-pattern";
import type { IVL } from "../ivl/types";
import { Build } from "../ivl/build";
import type { Clause, Literal } from "../cdcl/core";
import type { ArenaState, Enode } from "../theories/euf/arena";
import type { QuantifierInfo } from "./triggers";

export type MBQIResult = {
	readonly lemmas: readonly MBQILemma[];
	readonly newKeys: ReadonlySet<string>;
	readonly instantiations: readonly MBQIInstantiationInfo[];
};

export type MBQILemma = {
	readonly clause: Clause;
	readonly origin: string;
	readonly generation: number;
};

export type MBQIInstantiationInfo = {
	readonly substitution: ReadonlyMap<string, string>;
	readonly simplified: "true" | "false" | "formula";
};

export type MBQISubstitution = ReadonlyMap<string, IVL.Term>;

const MAX_MBQI_TERMS_PER_SORT = 10;

type MBQIAccumulator = {
	readonly lemmas: readonly MBQILemma[];
	readonly newKeys: ReadonlySet<string>;
	readonly instantiations: readonly MBQIInstantiationInfo[];
};

export const MBQI = {
	round: (
		quantifiers: readonly QuantifierInfo[],
		arena: ArenaState,
		instantiated: ReadonlySet<string>,
		generation: number,
		nextClauseId: () => number,
		encodeLemma: (formula: IVL.Formula) => readonly Literal[],
	): MBQIResult => {
		const arenaTerms = collectGroundTermsFromArena(arena);
		const bodyTerms = collectGroundTermsFromQuantifiers(quantifiers);
		const termsBySort = mergeTermMaps(arenaTerms, bodyTerms);

		return quantifiers.reduce<MBQIAccumulator>(
			(acc, qi) => {
				const substitutions = generateSubstitutions(qi.binders, termsBySort);
				return processSubstitutions(qi, substitutions, acc, instantiated, generation, nextClauseId, encodeLemma);
			},
			{ lemmas: [], newKeys: new Set(), instantiations: [] },
		);
	},
};

const processSubstitutions = (
	qi: QuantifierInfo,
	substitutions: readonly MBQISubstitution[],
	acc: MBQIAccumulator,
	instantiated: ReadonlySet<string>,
	generation: number,
	nextClauseId: () => number,
	encodeLemma: (formula: IVL.Formula) => readonly Literal[],
): MBQIAccumulator =>
	substitutions.reduce<MBQIAccumulator>((subAcc, sub) => {
		const key = instantiationKey(qi, sub);

		if (instantiated.has(key) || subAcc.newKeys.has(key)) {
			return subAcc;
		}

		const grounded = substituteFormula(qi.body, sub);
		return processGroundedFormula(grounded, key, qi, sub, generation, nextClauseId, encodeLemma, subAcc);
	}, acc);

const substitutionToStrings = (sub: MBQISubstitution): ReadonlyMap<string, string> => new Map([...sub.entries()].map(([k, v]) => [k, termToString(v)]));

const termToString = (term: IVL.Term): string =>
	match(term)
		.with({ tag: "Num" }, ({ value }) => value)
		.with({ tag: "Const" }, ({ name }) => name)
		.with({ tag: "Bool" }, ({ value }) => String(value))
		.with({ tag: "Str" }, ({ value }) => `"${value}"`)
		.otherwise(() => "?");

const classifyFormula = (formula: IVL.Formula): "true" | "false" | "formula" =>
	match(formula)
		.with({ tag: "True" }, () => "true" as const)
		.with({ tag: "False" }, () => "false" as const)
		.otherwise(() => "formula" as const);

const processGroundedFormula = (
	grounded: IVL.Formula,
	key: string,
	qi: QuantifierInfo,
	sub: MBQISubstitution,
	generation: number,
	nextClauseId: () => number,
	encodeLemma: (formula: IVL.Formula) => readonly Literal[],
	acc: MBQIAccumulator,
): MBQIAccumulator => {
	const subStrings = substitutionToStrings(sub);
	const simplified = classifyFormula(grounded);

	const tracked = {
		newKeys: new Set([...acc.newKeys, key]),
		instantiations: [...acc.instantiations, { substitution: subStrings, simplified }],
	};

	const lemma = (literals: readonly Literal[]): MBQILemma => ({
		clause: { id: nextClauseId(), literals: [...literals], origin: `mbqi:${qi.origin ?? "forall"}:gen${generation}` },
		origin: qi.origin ?? "forall",
		generation,
	});

	return match(simplified)
		.with("true", () => ({ ...acc, ...tracked }))
		.with("false", () => ({ lemmas: [...acc.lemmas, lemma([])], ...tracked }))
		.with("formula", () => {
			const literals = encodeLemma(grounded);
			return literals.length === 0 ? { ...acc, ...tracked } : { lemmas: [...acc.lemmas, lemma(literals)], ...tracked };
		})
		.exhaustive();
};

// --- Term collection ---

const sortKey = (sort: IVL.Sort): string =>
	match(sort)
		.with({ tag: "Bool" }, () => "Bool")
		.with({ tag: "Int" }, () => "Num")
		.with({ tag: "Real" }, () => "Num")
		.with({ tag: "String" }, () => "String")
		.with({ tag: "Unit" }, () => "Unit")
		.with({ tag: "Row" }, () => "Row")
		.with({ tag: "Fn" }, ({ args, ret }) => `Fn(${args.map(sortKey).join(",")}->${sortKey(ret)})`)
		.with({ tag: "Uninterpreted" }, ({ name }) => `U:${name}`)
		.exhaustive();

const termKey = (term: IVL.Term): string =>
	match(term)
		.with({ tag: "Num" }, ({ value }) => `num:${value}`)
		.with({ tag: "Const" }, ({ name }) => `const:${name}`)
		.with({ tag: "Bool" }, ({ value }) => `bool:${value}`)
		.with({ tag: "Str" }, ({ value }) => `str:${value}`)
		.otherwise(() => JSON.stringify(term));

const collectGroundTermsFromArena = (arena: ArenaState): ReadonlyMap<string, readonly IVL.Term[]> =>
	[...arena.nodes.entries()].reduce<ReadonlyMap<string, readonly IVL.Term[]>>((acc, [, node]) => {
		const key = sortKey(node.sort);
		const existing = acc.get(key) ?? [];
		const term = nodeToTerm(node, arena);
		return new Map([...acc, [key, [...existing, term]]]);
	}, new Map());

const collectGroundTermsFromTerm = (term: IVL.Term, boundVars: ReadonlySet<string>): readonly IVL.Term[] =>
	match(term)
		.with({ tag: "Var" }, ({ name }) => (boundVars.has(name) ? [] : [term]))
		.with({ tag: "Const" }, () => [term])
		.with({ tag: "Num" }, () => [term])
		.with({ tag: "Bool" }, () => [term])
		.with({ tag: "Str" }, () => [term])
		.with({ tag: "Arith" }, ({ args }) => args.flatMap(a => collectGroundTermsFromTerm(a, boundVars)))
		.with({ tag: "App" }, ({ args }) => args.flatMap(a => collectGroundTermsFromTerm(a, boundVars)))
		.with({ tag: "Select" }, ({ array, index }) => [...collectGroundTermsFromTerm(array, boundVars), ...collectGroundTermsFromTerm(index, boundVars)])
		.otherwise(() => []);

const collectGroundTermsFromFormula = (formula: IVL.Formula, boundVars: ReadonlySet<string>): readonly IVL.Term[] =>
	match(formula)
		.with({ tag: "Atom" }, ({ args }) => args.flatMap(a => collectGroundTermsFromTerm(a, boundVars)))
		.with({ tag: "And" }, ({ values }) => values.flatMap(v => collectGroundTermsFromFormula(v, boundVars)))
		.with({ tag: "Or" }, ({ values }) => values.flatMap(v => collectGroundTermsFromFormula(v, boundVars)))
		.with({ tag: "Not" }, ({ value }) => collectGroundTermsFromFormula(value, boundVars))
		.with({ tag: "Implies" }, ({ left, right }) => [...collectGroundTermsFromFormula(left, boundVars), ...collectGroundTermsFromFormula(right, boundVars)])
		.with({ tag: "Forall" }, ({ binders, body }) => {
			const newBound = new Set([...boundVars, ...binders.map(b => b.name)]);
			return collectGroundTermsFromFormula(body, newBound);
		})
		.with({ tag: "Exists" }, ({ binders, body }) => {
			const newBound = new Set([...boundVars, ...binders.map(b => b.name)]);
			return collectGroundTermsFromFormula(body, newBound);
		})
		.otherwise(() => []);

const collectGroundTermsFromQuantifiers = (quantifiers: readonly QuantifierInfo[]): ReadonlyMap<string, readonly IVL.Term[]> => {
	const allTerms = quantifiers.flatMap(qi => {
		const boundVars = new Set(qi.binders.map(b => b.name));
		return collectGroundTermsFromFormula(qi.body, boundVars);
	});

	const grouped = allTerms.reduce<ReadonlyMap<string, ReadonlyMap<string, IVL.Term>>>((acc, term) => {
		const sort = match(term)
			.with({ tag: "Num" }, t => sortKey(t.sort))
			.with({ tag: "Const" }, t => sortKey(t.sort))
			.with({ tag: "Bool" }, () => "Bool")
			.with({ tag: "Str" }, () => "String")
			.otherwise(() => "unknown");

		const existing = acc.get(sort) ?? new Map();
		const key = termKey(term);
		return new Map([...acc, [sort, new Map([...existing, [key, term]])]]);
	}, new Map());

	return new Map([...grouped.entries()].map(([sort, terms]) => [sort, [...terms.values()].slice(0, MAX_MBQI_TERMS_PER_SORT)]));
};

const mergeTermMaps = (a: ReadonlyMap<string, readonly IVL.Term[]>, b: ReadonlyMap<string, readonly IVL.Term[]>): ReadonlyMap<string, readonly IVL.Term[]> => {
	const allKeys = new Set([...a.keys(), ...b.keys()]);

	return [...allKeys].reduce<ReadonlyMap<string, readonly IVL.Term[]>>((acc, key) => {
		const aTerms = a.get(key) ?? [];
		const bTerms = b.get(key) ?? [];
		const merged = deduplicateTerms([...aTerms, ...bTerms]).slice(0, MAX_MBQI_TERMS_PER_SORT);
		return new Map([...acc, [key, merged]]);
	}, new Map());
};

const deduplicateTerms = (terms: readonly IVL.Term[]): readonly IVL.Term[] =>
	terms.reduce<{ seen: ReadonlySet<string>; result: readonly IVL.Term[] }>(
		(acc, t) => {
			const k = termKey(t);
			return acc.seen.has(k) ? acc : { seen: new Set([...acc.seen, k]), result: [...acc.result, t] };
		},
		{ seen: new Set(), result: [] },
	).result;

// --- Substitution generation ---

const generateSubstitutions = (binders: readonly IVL.Binder[], termsBySort: ReadonlyMap<string, readonly IVL.Term[]>): readonly MBQISubstitution[] => {
	const binderTerms = binders.map(b => {
		const key = sortKey(b.sort);
		return { name: b.name, terms: termsBySort.get(key) ?? [] };
	});

	const hasEmptyDomain = binderTerms.some(bt => bt.terms.length === 0);

	if (hasEmptyDomain) {
		return [];
	}

	const cartesian = (remaining: readonly { name: string; terms: readonly IVL.Term[] }[], current: MBQISubstitution): readonly MBQISubstitution[] =>
		match(remaining)
			.with([], () => [current])
			.otherwise(([first, ...rest]) => first.terms.flatMap(term => cartesian(rest, new Map([...current, [first.name, term]]))));

	return cartesian(binderTerms, new Map());
};

const instantiationKey = (qi: QuantifierInfo, sub: MBQISubstitution): string => {
	const bindings = qi.binders.map(b => `${b.name}=${termKey(sub.get(b.name) ?? Build.const_("?", Build.Unit))}`).join(",");
	return `mbqi:${qi.origin ?? "q"}[${bindings}]`;
};

const nodeToTerm = (node: Enode, arena: ArenaState): IVL.Term =>
	match(node.args.length)
		.with(0, () => Build.const_(node.head, node.sort))
		.otherwise(() =>
			Build.app(
				node.head,
				node.args.map(argId => {
					const argNode = arena.nodes.get(argId);
					return argNode ? nodeToTerm(argNode, arena) : Build.const_(`?${argId}`, node.sort);
				}),
				node.sort,
			),
		);

// --- Syntactic substitution ---

const substituteTerm = (term: IVL.Term, sub: MBQISubstitution): IVL.Term =>
	match(term)
		.with({ tag: "Var" }, ({ name, sort }) => sub.get(name) ?? Build.var_(name, sort))
		.with({ tag: "Arith" }, ({ op, args, sort }) => Build.arith(op, substituteTerm(args[0], sub), substituteTerm(args[1], sub), sort))
		.with({ tag: "App" }, ({ head, args, sort }) =>
			Build.app(
				head,
				args.map(a => substituteTerm(a, sub)),
				sort,
			),
		)
		.with({ tag: "Select" }, ({ array, index, sort }) => Build.select(substituteTerm(array, sub), substituteTerm(index, sub), sort))
		.otherwise(() => term);

const substituteFormula = (formula: IVL.Formula, sub: MBQISubstitution): IVL.Formula =>
	match(formula)
		.with({ tag: "Atom" }, ({ op, args, origin }) => Build.atom(op, substituteTerm(args[0], sub), substituteTerm(args[1], sub), origin))
		.with({ tag: "Not" }, ({ value, origin }) => Build.not(substituteFormula(value, sub), origin))
		.with({ tag: "And" }, ({ values, origin }) =>
			Build.andWithOrigin(
				values.map(v => substituteFormula(v, sub)),
				origin,
			),
		)
		.with({ tag: "Or" }, ({ values, origin }) =>
			Build.orWithOrigin(
				values.map(v => substituteFormula(v, sub)),
				origin,
			),
		)
		.with({ tag: "Implies" }, ({ left, right, origin }) => Build.implies(substituteFormula(left, sub), substituteFormula(right, sub), origin))
		.with({ tag: "Forall" }, f => f)
		.with({ tag: "Exists" }, f => f)
		.with({ tag: "True" }, f => f)
		.with({ tag: "False" }, f => f)
		.exhaustive();
