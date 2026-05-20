// Solver: top-level API wiring normalization, skolemization, Tseitin CNF,
// CDCL boolean core, EUF theory, arithmetic theory, and quantifier instantiation
// into a single assert/check interface for IVL formulas.
// Generator-based: solveTrace yields Step events for tracing/debugging.

import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import { IVL } from "./ivl/types";
import { Build } from "./ivl/build";
import { normalize } from "./normalize";
import { skolemize } from "./skolem";
import { tseitin, type CNFResult, type AtomInfo, type ProxyInfo } from "./cnf";
import { CDCL, Literal, type Variable, type Clause, type CDCLResult } from "./cdcl/core";
import { Arena, type ArenaState, type EnodeId } from "./theories/euf/arena";
import { EUF, type CCState } from "./theories/euf/cc";
import { Arithmetic } from "./theories/arithmetic/solver";
import { QuantifierEngine, type QuantifierState } from "./quantifiers/solver";
import type { Theory } from "./theories/theory";
import { Trace, type Step } from "./trace";

export type SolveResult =
	| { readonly tag: "sat"; readonly model: Model }
	| { readonly tag: "unsat"; readonly core: readonly string[] }
	| { readonly tag: "unknown"; readonly reason: string };

export type Model = {
	readonly evaluate: (term: IVL.Term) => O.Option<IVL.Term>;
};

export type AtomTable = ReadonlyMap<Literal, AtomInfo>;

export type ProxyTable = ReadonlyMap<Variable, ProxyInfo>;

export type TracedCheck = {
	readonly formula: IVL.Formula;
	readonly trace: Generator<Step, SolveResult>;
	readonly atoms: AtomTable;
	readonly proxies: ProxyTable;
	readonly clauses: readonly Clause[];
};

export type SolverInstance = {
	readonly assert: (formula: IVL.Formula, origin?: string) => void;
	readonly check: () => SolveResult;
	readonly push: () => void;
	readonly pop: () => void;
};

export type TracedSolverInstance = {
	readonly assert: (formula: IVL.Formula, origin?: string) => void;
	readonly check: () => TracedCheck;
	readonly push: () => void;
	readonly pop: () => void;
};

// Justification for let: The solver accumulates asserted formulas across multiple
// assert() calls and maintains a stack for push/pop. This is the standard interface
// for incremental SMT solvers and is inherently stateful at the API boundary.

const createBase = () => {
	// Justification for let: incremental solver API boundary (assert/push/pop)
	let formulas: IVL.Formula[] = [];
	let stack: IVL.Formula[][] = [];

	return {
		assert: (formula: IVL.Formula, origin?: string) => {
			const tagged = origin ? { ...formula, origin } : formula;
			formulas.push(tagged);
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
		combined: () => (formulas.length === 1 ? formulas[0] : Build.and(...formulas)),
	};
};

export const Solver = {
	create: (): SolverInstance => {
		const base = createBase();
		return { ...base, check: () => solve(base.combined()) };
	},

	createTraced: (): TracedSolverInstance => {
		const base = createBase();
		return { ...base, check: () => prepare(base.combined()) };
	},
};

const MAX_QUANTIFIER_ROUNDS = 5;

const prepare = (formula: IVL.Formula): TracedCheck => {
	const normalized = normalize(formula);
	const skolemized = skolemize(normalized);
	const { propositional, quantifiers } = separate(skolemized);
	const cnfResult = tseitin(propositional);
	const setup = buildSetup(cnfResult);

	// Justification for forEach: theory registration mutates encapsulated theory state;
	// the Theory interface is inherently side-effecting (assert/push/pop protocol).
	setup.equalities.forEach(eq => EUF.register(setup.ccState, eq.literal, eq.a, eq.b, eq.positive));
	setup.arithmetics.forEach(entry => Arithmetic.register(setup.arithState, entry.literal, entry.info, entry.positive));

	const theories: Theory[] = [setup.eufTheory, setup.arithTheory];
	const qEngine = quantifiers.length > 0 ? O.some(QuantifierEngine.create(Build.and(...quantifiers.map(q => q as IVL.Formula)))) : O.none;

	return {
		formula,
		trace: quantifierLoopTrace(cnfResult.clauses, theories, qEngine, setup, cnfResult, 0),
		atoms: cnfResult.atoms,
		proxies: cnfResult.proxies,
		clauses: cnfResult.clauses,
	};
};

const solve = (formula: IVL.Formula): SolveResult => Trace.drain(prepare(formula).trace);

function* quantifierLoopTrace(
	clauses: readonly Clause[],
	theories: readonly Theory[],
	qEngine: O.Option<QuantifierState>,
	setup: SolveSetup,
	cnfResult: CNFResult,
	round: number,
): Generator<Step, SolveResult> {
	const cdclResult = yield* CDCL.solveTrace(clauses, theories);

	return yield* match(cdclResult)
		.with({ tag: "unsat" }, function* ({ core }): Generator<Step, SolveResult> {
			return { tag: "unsat", core: core.map(c => c.origin) };
		})
		.with({ tag: "sat" }, function* ({ assignments }): Generator<Step, SolveResult> {
			return yield* pipe(
				qEngine,
				O.match(
					function* (): Generator<Step, SolveResult> {
						return { tag: "sat", model: createModel(assignments, cnfResult, setup.arena) };
					},
					function* (engine): Generator<Step, SolveResult> {
						if (round >= MAX_QUANTIFIER_ROUNDS) {
							return { tag: "unknown", reason: "quantifier instantiation limit reached" };
						}

						const findRep = (id: EnodeId) => EUF.find(setup.ccState, id);
						// Justification for let: QuantifierEngine.round requires a mutable ID generator
						let nextId = clauses.reduce((max, c) => Math.max(max, c.id), 0) + 1;
						const { lemmas, state: updatedEngine } = QuantifierEngine.round(engine, setup.arena, findRep, () => nextId++, encodeLemma(cnfResult));

						yield { tag: "quantifier-round", round, lemmas: lemmas.length };

						if (lemmas.length === 0) {
							return { tag: "sat", model: createModel(assignments, cnfResult, setup.arena) };
						}

						return yield* quantifierLoopTrace([...clauses, ...lemmas.map(l => l.clause)], theories, O.some(updatedEngine), setup, cnfResult, round + 1);
					},
				),
			);
		})
		.exhaustive();
}

const encodeLemma =
	(cnfResult: CNFResult) =>
	(formula: IVL.Formula): readonly Literal[] =>
		match(formula)
			.with({ tag: "Atom" }, atom => {
				const direct = findAtomLiteral(cnfResult, atom.op, atom.args);
				return pipe(
					direct,
					O.match(
						() =>
							pipe(
								findComplementary(cnfResult, atom.op, atom.args),
								O.match(
									() => [],
									lit => [Literal.negate(lit)],
								),
							),
						lit => [lit],
					),
				);
			})
			.with({ tag: "Not" }, ({ value }) => encodeLemma(cnfResult)(value).map(Literal.negate))
			.with({ tag: "And" }, ({ values }) => values.flatMap(v => encodeLemma(cnfResult)(v)))
			.with({ tag: "True" }, () => [])
			.with({ tag: "False" }, () => [])
			.otherwise(() => []);

const COMPLEMENTARY_OPS: ReadonlyMap<IVL.AtomOp, IVL.AtomOp> = new Map([
	["=", "!="],
	["!=", "="],
	["<", ">="],
	[">=", "<"],
	["<=", ">"],
	[">", "<="],
]);

const findAtomLiteral = (cnfResult: CNFResult, op: IVL.AtomOp, args: readonly [IVL.Term, IVL.Term]): O.Option<Literal> =>
	pipe(
		[...cnfResult.atoms.entries()],
		A.findFirstMap(([lit, info]) => (info.op === op && termEqual(info.args[0], args[0]) && termEqual(info.args[1], args[1]) ? O.some(lit) : O.none)),
	);

const findComplementary = (cnfResult: CNFResult, op: IVL.AtomOp, args: readonly [IVL.Term, IVL.Term]): O.Option<Literal> =>
	pipe(
		COMPLEMENTARY_OPS.get(op),
		O.fromNullable,
		O.chain(complement => findAtomLiteral(cnfResult, complement, args)),
	);

const termEqual = (a: IVL.Term, b: IVL.Term): boolean => a.tag === b.tag && JSON.stringify(a) === JSON.stringify(b);

type ArithEntry = {
	readonly literal: Literal;
	readonly info: AtomInfo;
	readonly positive: boolean;
};

type EqualityEntry = {
	readonly literal: Literal;
	readonly a: EnodeId;
	readonly b: EnodeId;
	readonly positive: boolean;
};

type SolveSetup = {
	readonly arena: ArenaState;
	readonly equalities: readonly EqualityEntry[];
	readonly arithmetics: readonly ArithEntry[];
	readonly eufTheory: Theory;
	readonly arithTheory: Theory;
	readonly ccState: CCState;
	readonly arithState: ReturnType<typeof Arithmetic.create>["state"];
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

const ARITH_OPS: readonly IVL.AtomOp[] = ["<", "<=", ">", ">="];

const buildSetup = (cnfResult: CNFResult): SolveSetup => {
	const { arena, equalities, arithmetics } = [...cnfResult.atoms.entries()].reduce<{
		arena: ArenaState;
		equalities: EqualityEntry[];
		arithmetics: ArithEntry[];
	}>(
		(acc, [literal, info]) => {
			const { internedA, internedB, state: newArena } = internTerms(acc.arena, info.args[0], info.args[1]);

			return match(info.op)
				.with("=", () => ({
					arena: newArena,
					equalities: [...acc.equalities, { literal, a: internedA, b: internedB, positive: true }],
					arithmetics: [...acc.arithmetics, { literal, info, positive: true }],
				}))
				.with("!=", () => ({
					arena: newArena,
					equalities: [...acc.equalities, { literal, a: internedA, b: internedB, positive: false }],
					arithmetics: [...acc.arithmetics, { literal, info, positive: false }],
				}))
				.otherwise(op => ({
					arena: newArena,
					equalities: acc.equalities,
					arithmetics: ARITH_OPS.includes(op) ? [...acc.arithmetics, { literal, info, positive: true }] : acc.arithmetics,
				}));
		},
		{ arena: Arena.create(), equalities: [], arithmetics: [] },
	);

	const { theory: eufTheory, state: ccState } = EUF.create(arena);
	const { theory: arithTheory, state: arithState } = Arithmetic.create();

	return { arena, equalities, arithmetics, eufTheory, arithTheory, ccState, arithState };
};

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
