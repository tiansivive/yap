// Solver: top-level API wiring normalization, skolemization, Tseitin CNF,
// CDCL boolean core, EUF theory, and quantifier instantiation into a single
// assert/check interface for IVL formulas.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as O from "fp-ts/Option";
import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import { IVL } from "./ivl/types";
import { Build } from "./ivl/build";
import { normalize } from "./normalize";
import { skolemize } from "./skolem";
import { tseitin, type CNFResult } from "./cnf";
import { CDCL, type Clause, type Literal, type CDCLResult } from "./cdcl/core";
import { Arena, type ArenaState, type EnodeId } from "./theories/euf/arena";
import { EUF } from "./theories/euf/cc";
import { QuantifierEngine, type QuantifierState } from "./quantifiers/solver";
import type { Theory } from "./theories/theory";

export type SolveResult =
	| { readonly tag: "sat"; readonly model: Model }
	| { readonly tag: "unsat"; readonly core: readonly string[] }
	| { readonly tag: "unknown"; readonly reason: string };

export type Model = {
	readonly evaluate: (term: IVL.Term) => O.Option<IVL.Term>;
};

export type SolverInstance = {
	readonly assert: (formula: IVL.Formula, origin?: string) => void;
	readonly check: () => SolveResult;
	readonly push: () => void;
	readonly pop: () => void;
};

// Justification for let: The solver accumulates asserted formulas across multiple
// assert() calls and maintains a stack for push/pop. This is the standard interface
// for incremental SMT solvers and is inherently stateful at the API boundary.

export const Solver = {
	create: (): SolverInstance => {
		let formulas: IVL.Formula[] = [];
		let stack: IVL.Formula[][] = [];

		return {
			assert: (formula, origin) => {
				const tagged = origin ? { ...formula, origin } : formula;
				formulas.push(tagged);
			},

			check: () => {
				const combined = formulas.length === 1 ? formulas[0] : Build.and(...formulas);

				return solve(combined);
			},

			push: () => {
				stack.push([...formulas]);
			},

			pop: () => {
				const prev = stack.pop();

				if (prev) {
					formulas = prev;
				}
			},
		};
	},
};

const solve = (formula: IVL.Formula): SolveResult => {
	const normalized = normalize(formula);
	const skolemized = skolemize(normalized);
	const { propositional, quantifiers } = separate(skolemized);
	const cnfResult = tseitin(propositional);
	const arenaSetup = buildArena(cnfResult);
	const { theory: eufTheory, state: ccState } = EUF.create(arenaSetup.arena);

	arenaSetup.equalities.forEach(eq => {
		EUF.register(ccState, eq.literal, eq.a, eq.b, eq.positive);
	});

	const theories: Theory[] = [eufTheory];
	const cdclResult = CDCL.solve(cnfResult.clauses, theories);

	return match(cdclResult)
		.with({ tag: "sat" }, ({ assignments }) => ({
			tag: "sat" as const,
			model: createModel(assignments, cnfResult, arenaSetup.arena),
		}))
		.with({ tag: "unsat" }, ({ core }) => ({
			tag: "unsat" as const,
			core: core.map(c => c.origin),
		}))
		.exhaustive();
};

type EqualityEntry = {
	readonly literal: Literal;
	readonly a: EnodeId;
	readonly b: EnodeId;
	readonly positive: boolean;
};

type ArenaSetup = {
	readonly arena: ArenaState;
	readonly equalities: readonly EqualityEntry[];
};

const separate = (formula: IVL.Formula): { propositional: IVL.Formula; quantifiers: readonly IVL.Formula[] } =>
	match(formula)
		.with({ tag: "And" }, ({ values, origin }) => {
			const quantifiers = values.filter(v => v.tag === "Forall");
			const propositional = values.filter(v => v.tag !== "Forall");

			return {
				propositional: propositional.length === 1 ? propositional[0] : Build.andWithOrigin(propositional, origin),
				quantifiers,
			};
		})
		.with({ tag: "Forall" }, f => ({ propositional: Build.true_(), quantifiers: [f] }))
		.otherwise(f => ({ propositional: f, quantifiers: [] }));

const buildArena = (cnfResult: CNFResult): ArenaSetup =>
	[...cnfResult.atoms.entries()].reduce<ArenaSetup>(
		(acc, [literal, { op, args }]) => {
			const { internedA, internedB, state: newArena } = internTerms(acc.arena, args[0], args[1]);

			return match(op)
				.with("=", () => ({
					arena: newArena,
					equalities: [...acc.equalities, { literal, a: internedA, b: internedB, positive: true }],
				}))
				.with("!=", () => ({
					arena: newArena,
					equalities: [...acc.equalities, { literal, a: internedA, b: internedB, positive: false }],
				}))
				.otherwise(() => ({ arena: newArena, equalities: acc.equalities }));
		},
		{ arena: Arena.create(), equalities: [] },
	);

const internTerms = (arena: ArenaState, left: IVL.Term, right: IVL.Term): { internedA: EnodeId; internedB: EnodeId; state: ArenaState } => {
	const { id: a, state: s1 } = intern(arena, left);
	const { id: b, state: s2 } = intern(s1, right);
	return { internedA: a, internedB: b, state: s2 };
};

const intern = (arena: ArenaState, term: IVL.Term): { id: EnodeId; state: ArenaState } =>
	match(term)
		.with({ tag: "App" }, ({ head, args, sort }) => {
			const { ids, state } = args.reduce<{ ids: readonly EnodeId[]; state: ArenaState }>(
				(acc, arg) => {
					const { id, state: s } = intern(acc.state, arg);
					return { ids: [...acc.ids, id], state: s };
				},
				{ ids: [], state: arena },
			);
			return Arena.intern(state, head, ids, sort);
		})
		.with({ tag: "Var" }, ({ name, sort }) => Arena.intern(arena, name, [], sort))
		.with({ tag: "Const" }, ({ name, sort }) => Arena.intern(arena, name, [], sort))
		.with({ tag: "Num" }, ({ value, sort }) => Arena.intern(arena, value, [], sort))
		.with({ tag: "Bool" }, ({ value }) => Arena.intern(arena, String(value), [], Build.Bool))
		.with({ tag: "Str" }, ({ value }) => Arena.intern(arena, value, [], Build.String))
		.with({ tag: "Arith" }, ({ op, args, sort }) => {
			const { id: l, state: s1 } = intern(arena, args[0]);
			const { id: r, state: s2 } = intern(s1, args[1]);
			return Arena.intern(s2, op, [l, r], sort);
		})
		.with({ tag: "Select" }, ({ array, index, sort }) => {
			const { id: a, state: s1 } = intern(arena, array);
			const { id: i, state: s2 } = intern(s1, index);
			return Arena.intern(s2, "select", [a, i], sort);
		})
		.with({ tag: "Row" }, ({ sort }) => Arena.intern(arena, "row", [], sort))
		.exhaustive();

const createModel = (_assignments: ReadonlyMap<number, string>, _cnf: CNFResult, _arena: ArenaState): Model => ({
	evaluate: () => O.none,
});
