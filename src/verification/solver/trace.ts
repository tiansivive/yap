// Solver trace: step-by-step event type and consumer utilities.
// Enables observable CDCL(T) execution — silent, logged, or interactive.
// CDCL(T) = Conflict-Driven Clause Learning modulo Theories; EUF = Equality with Uninterpreted Functions;
// MBQI = Model-Based Quantifier Instantiation
// https://github.com/tiansivive/z-yap/blob/main/zettels/solver-trace.md

import * as PP from "prettier-printer";
import { match } from "ts-pattern";
import { Print } from "./ivl/print";
import type { Clause, Literal, Variable, Assignment } from "./cdcl/core";
import type { AtomInfo, ProxyInfo, CNFResult } from "./cnf";
import type { TheoryStep } from "./theories/theory";
import { EUFTrace, ArithTrace } from "./theories/theory";
import { Rational } from "./theories/arithmetic/rational";
import type { ArenaState, EnodeId } from "./theories/euf/arena";

export type Step =
	| { readonly tag: "propagate"; readonly literal: Literal; readonly reason: Clause }
	| { readonly tag: "conflict"; readonly clause: Clause }
	| { readonly tag: "decide"; readonly literal: Literal; readonly level: number }
	| {
			readonly tag: "theory-assert";
			readonly theory: string;
			readonly literal: Literal;
			readonly result: "ok" | "conflict";
			readonly detail: readonly TheoryStep[];
	  }
	| { readonly tag: "theory-check"; readonly theory: string; readonly result: "ok" | "conflict"; readonly detail: readonly TheoryStep[] }
	| { readonly tag: "theory-push"; readonly level: number }
	| { readonly tag: "theory-pop"; readonly to: number }
	| { readonly tag: "analyze"; readonly conflict: Clause; readonly learned: Clause; readonly backtrackLevel: number }
	| { readonly tag: "backjump"; readonly from: number; readonly to: number }
	| { readonly tag: "quantifier-round"; readonly round: number; readonly lemmas: number }
	| {
			readonly tag: "mbqi-round";
			readonly round: number;
			readonly instantiations: readonly MBQIInstantiation[];
	  }
	| { readonly tag: "pure-quantifier"; readonly quantifiers: number }
	| { readonly tag: "sat"; readonly assignments: ReadonlyMap<Variable, Assignment> }
	| { readonly tag: "unsat"; readonly core: readonly Clause[] };

export type MBQIInstantiation = {
	readonly substitution: ReadonlyMap<string, string>;
	readonly simplified: "true" | "false" | "formula";
};

export type ReplayMode = "symbolic" | "expanded";

type AtomTable = ReadonlyMap<Literal, AtomInfo>;
type ProxyTable = ReadonlyMap<Variable, ProxyInfo>;
type Doc = PP.IDoc;
type Assignments = ReadonlyMap<Variable, boolean>;

const NL = PP.line;
const BLANK = [NL, NL];
const REPLAY_WIDTH = 120;
const REPLAY_COL_WIDTH = 36;
const STATUS_GUTTER = 2;

export const Trace = {
	print: (step: Step, atoms: AtomTable = new Map()): string =>
		match(step)
			.with({ tag: "propagate" }, ({ literal, reason }) => `[propagate]  ${litName(literal, atoms)}  (${clauseStr(reason, expandedNamer(atoms))})`)
			.with({ tag: "conflict" }, ({ clause }) => `[conflict]   ${clauseStr(clause, expandedNamer(atoms))}`)
			.with({ tag: "decide" }, ({ literal, level }) => `[decide]     ${litName(literal, atoms)}  (level ${level})`)
			.with({ tag: "theory-assert" }, ({ theory, literal, result }) => `[theory]     ${theory} assert ${litName(literal, atoms)}: ${result}`)
			.with({ tag: "theory-check" }, ({ theory, result }) => `[theory]     ${theory} check: ${result}`)
			.with({ tag: "theory-push" }, ({ level }) => `[push]       level ${level}`)
			.with({ tag: "theory-pop" }, ({ to }) => `[pop]        -> level ${to}`)
			.with(
				{ tag: "analyze" },
				({ conflict, learned, backtrackLevel }) =>
					`[analyze]    conflict ${clauseStr(conflict, expandedNamer(atoms))} -> learned ${clauseStr(learned, expandedNamer(atoms))} (backjump -> ${backtrackLevel})`,
			)
			.with({ tag: "backjump" }, ({ from, to }) => `[backjump]   level ${from} -> ${to}`)
			.with({ tag: "quantifier-round" }, ({ round, lemmas }) => `[quant]      round ${round}: ${lemmas} lemmas`)
			.with({ tag: "mbqi-round" }, ({ round, instantiations }) => {
				const details = instantiations.map(i => `${formatSubstitution(i.substitution)}→${i.simplified}`).join(", ");
				return `[mbqi]       round ${round}: ${details || "no instantiations"}`;
			})
			.with({ tag: "pure-quantifier" }, ({ quantifiers }) => `[pure-quant] ${quantifiers} quantifier(s)`)
			.with({ tag: "sat" }, () => `[sat]`)
			.with({ tag: "unsat" }, ({ core }) => `[unsat]      core: [${core.map(c => clauseId(c.id)).join(", ")}]`)
			.exhaustive(),

	drain: <R>(gen: Generator<Step, R>): R => {
		const step = (it: Generator<Step, R>): R => {
			const next = it.next();
			return next.done ? next.value : step(it);
		};
		return step(gen);
	},

	collect: <R>(gen: Generator<Step, R>): { readonly steps: readonly Step[]; readonly result: R } => {
		const step = (it: Generator<Step, R>, acc: readonly Step[]): { readonly steps: readonly Step[]; readonly result: R } => {
			const next = it.next();
			return next.done ? { steps: acc, result: next.value } : step(it, [...acc, next.value]);
		};
		return step(gen, []);
	},

	log: <R>(gen: Generator<Step, R>, atoms: AtomTable = new Map()): R => {
		const step = (it: Generator<Step, R>): R => {
			const next = it.next();

			if (next.done) {
				return next.value;
			}
			console.log(Trace.print(next.value, atoms));
			return step(it);
		};
		return step(gen);
	},

	format: (steps: readonly Step[], atoms: AtomTable = new Map()): string => steps.map(s => Trace.print(s, atoms)).join("\n"),

	replay: (opts: {
		readonly formula: string;
		readonly steps: readonly Step[];
		readonly atoms: AtomTable;
		readonly proxies: ProxyTable;
		readonly clauses: readonly Clause[];
		readonly arena?: ArenaState;
		readonly mode?: ReplayMode;
	}): string => {
		const { formula, steps, atoms, proxies, clauses, arena, mode = "symbolic" } = opts;
		const name = mkNamer(mode, atoms);

		const defaultArena: ArenaState = { nodes: new Map(), hashIndex: new Map(), nextId: 0 };
		const theoryArena = arena ?? defaultArena;

		const initialTheories: TheoryReplayState = {
			euf: { classes: initEqClasses(theoryArena), initialized: false },
			arith: { bounds: new Map() },
		};
		const initialState: ReplayState = { trail: [], assignments: new Map(), allClauses: clauses, theories: initialTheories };

		// prettier-printer rejects strings with embedded newlines; split into per-line Docs.
		const formulaLines: Doc = PP.intersperse(
			NL,
			formula.split("\n").map(l => `  ${l}`),
		);
		const preamble: Doc = ["=== Formula ===", NL, formulaLines, BLANK, atomsSection(atoms, proxies, name), BLANK, clauseStateDoc(clauses, name, new Map()), NL];

		const fold = (remaining: readonly Step[], state: ReplayState, acc: Doc[]): Doc[] =>
			remaining.length === 0
				? acc
				: (() => {
						const { docs, state: next } = replayStep(remaining[0], name, state, theoryArena, atoms);
						return fold(remaining.slice(1), next, [...acc, docs]);
					})();

		const doc: Doc = [preamble, ...fold(steps, initialState, [])];
		return render(doc);
	},

	fromCNF: (cnfResult: CNFResult): AtomTable => cnfResult.atoms,
};

// --- Replay state machine ---

type TrailEntry = { readonly literal: Literal; readonly level: number; readonly reason: string };

type ReplayState = {
	readonly trail: readonly TrailEntry[];
	readonly assignments: Assignments;
	readonly allClauses: readonly Clause[];
	readonly theories: TheoryReplayState;
};

const assignLit = (assignments: Assignments, lit: Literal): Assignments => new Map([...assignments, [Math.abs(lit), lit > 0]]);

const unassignAbove = (state: ReplayState, level: number): ReplayState => {
	const trail = state.trail.filter(e => e.level <= level);
	const assignments = trail.reduce<Assignments>((acc, e) => assignLit(acc, e.literal), new Map<Variable, boolean>());
	return { ...state, trail, assignments };
};

const assignmentStep = (
	tag: string,
	body: string,
	literal: Literal,
	level: number,
	reason: string,
	name: Namer,
	state: ReplayState,
): { readonly docs: Doc; readonly state: ReplayState } => {
	const next: ReplayState = {
		...state,
		trail: [...state.trail, { literal, level, reason }],
		assignments: assignLit(state.assignments, literal),
	};
	return {
		docs: [NL, `[${tag}]  ${body}`, trailLine(next.trail, name), NL, clauseStateDoc(next.allClauses, name, next.assignments), NL],
		state: next,
	};
};

const replayStep = (step: Step, name: Namer, state: ReplayState, arena: ArenaState, atoms: AtomTable): { readonly docs: Doc; readonly state: ReplayState } =>
	match(step)
		.with({ tag: "decide" }, ({ literal, level }) =>
			assignmentStep("decide", `${name(literal)} = ${literal > 0 ? "true" : "false"}  (level ${level})`, literal, level, "decision", name, state),
		)
		.with({ tag: "propagate" }, ({ literal, reason }) => {
			const level = state.trail.length > 0 ? state.trail[state.trail.length - 1].level : 0;
			return assignmentStep(
				"propagate",
				`${name(literal)} = ${literal > 0 ? "true" : "false"}  (forced by ${clauseStr(reason, name)})`,
				literal,
				level,
				clauseId(reason.id),
				name,
				state,
			);
		})
		.with({ tag: "conflict" }, ({ clause }) => {
			const isTheory = clause.id < 0;
			const symbolic = clause.literals.map(name).join(" v ");
			const expanded = clause.literals.map(l => expandedNamer(atoms)(l)).join(" v ");
			const body = isTheory ? `${clause.origin}: ${symbolic} → ${expanded}` : `${clauseStr(clause, name)}`;
			return {
				docs: [NL, `[conflict]  ${body} — all literals false`],
				state,
			};
		})
		.with({ tag: "analyze" }, ({ conflict, learned, backtrackLevel }) => ({
			docs: [
				NL,
				"[analyze]",
				NL,
				`  conflict  ${clauseStr(conflict, name)}`,
				NL,
				`  learned   ${clauseStr(learned, name)}`,
				NL,
				`  backjump -> level ${backtrackLevel}`,
			],
			state: { ...state, allClauses: [...state.allClauses, learned] },
		}))
		.with({ tag: "backjump" }, ({ from, to }) => {
			const next = unassignAbove(state, to);
			return {
				docs: [NL, `[backjump]  level ${from} -> ${to}`, trailLine(next.trail, name), NL, clauseStateDoc(next.allClauses, name, next.assignments), NL],
				state: next,
			};
		})
		.with({ tag: "theory-assert" }, ({ theory, literal, result, detail }) => {
			const { docs: detailDocs, hasContent, state: nextTheories } = replayTheoryDetail(detail, theory, state.theories, arena, name, atoms);
			return {
				docs: [NL, `[theory]  ${theory} assert ${name(literal)}: ${result}`, detailDocs, hasContent ? NL : []],
				state: { ...state, theories: nextTheories },
			};
		})
		.with({ tag: "theory-check" }, ({ theory, result, detail }) => {
			const { docs: detailDocs, hasContent, state: nextTheories } = replayTheoryDetail(detail, theory, state.theories, arena, name, atoms);
			return {
				docs: [NL, `[theory]  ${theory} check: ${result}`, detailDocs, hasContent ? NL : []],
				state: { ...state, theories: nextTheories },
			};
		})
		.with({ tag: "theory-push" }, ({ level }) => ({
			docs: [NL, `[push]  level ${level}`],
			state,
		}))
		.with({ tag: "theory-pop" }, ({ to }) => ({
			docs: [NL, `[pop]  -> level ${to}`],
			state: unassignAbove(state, to),
		}))
		.with({ tag: "quantifier-round" }, ({ round, lemmas }) => ({
			docs: [NL, `[quant]  round ${round}: ${lemmas} lemmas`],
			state: { ...state, trail: [], assignments: new Map() },
		}))
		.with({ tag: "mbqi-round" }, ({ round, instantiations }) => ({
			docs: [
				NL,
				`[mbqi]   round ${round}: ${instantiations.length} instantiation(s)`,
				...instantiations.map(inst => [NL, `           ${formatSubstitution(inst.substitution)} → ${inst.simplified}`]),
			],
			state: { ...state, trail: [], assignments: new Map() },
		}))
		.with({ tag: "pure-quantifier" }, ({ quantifiers }) => ({
			docs: [NL, `[pure-quant]  ${quantifiers} quantifier(s), skipping propositional phase`],
			state,
		}))
		.with({ tag: "sat" }, () => ({
			docs: [NL, "[sat]"],
			state,
		}))
		.with({ tag: "unsat" }, ({ core }) => ({
			docs: [NL, `[unsat]  core: [${core.map(c => clauseId(c.id)).join(", ")}]`],
			state,
		}))
		.exhaustive();

// --- Combined theory replay ---

type TheoryReplayState = {
	readonly euf: EUFReplayState;
	readonly arith: ArithReplayState;
};

const isEUFStep = (s: TheoryStep): s is EUFTrace.Step =>
	s.tag === "merge" || s.tag === "merge-skip" || s.tag === "congruence" || s.tag === "conflict" || s.tag === "scan";

const replayTheoryDetail = (
	detail: readonly TheoryStep[],
	theory: string,
	tState: TheoryReplayState,
	arena: ArenaState,
	name: Namer,
	atoms: AtomTable,
): { readonly docs: Doc; readonly hasContent: boolean; readonly state: TheoryReplayState } => {
	if (detail.length === 0) {
		return { docs: [], hasContent: false, state: tState };
	}

	const showEufInit = theory === "euf" && !tState.euf.initialized && detail.some(isEUFStep);

	const startState: TheoryReplayState = showEufInit ? { ...tState, euf: { ...tState.euf, initialized: true } } : tState;

	const initialDoc: Doc[] = showEufInit ? [[NL, `    classes: ${allClassesStr(tState.euf.classes, arena)}`]] : [];

	const fold = (remaining: readonly TheoryStep[], current: TheoryReplayState, acc: Doc[]): { readonly docs: Doc[]; readonly state: TheoryReplayState } => {
		if (remaining.length === 0) {
			return { docs: acc, state: current };
		}

		const [step, ...rest] = remaining;

		if (isEUFStep(step)) {
			const { lines, state: nextEuf } = replayEUFStep(step, current.euf, arena, name, atoms);
			const lineDocs: Doc[] = lines.map(l => [NL, `    ${l}`]);
			return fold(rest, { ...current, euf: nextEuf }, [...acc, ...lineDocs]);
		}

		const { lines, state: nextArith } = replayArithStep(step, current.arith, atoms);
		const lineDocs: Doc[] = lines.map(l => [NL, `    ${l}`]);
		return fold(rest, { ...current, arith: nextArith }, [...acc, ...lineDocs]);
	};

	const { docs: stepDocs, state: nextState } = fold(detail, startState, initialDoc);
	return { docs: stepDocs, hasContent: true, state: nextState };
};

// --- EUF replay state ---

type EqClass = ReadonlyMap<EnodeId, ReadonlySet<EnodeId>>;

const enodeName = (arena: ArenaState, id: EnodeId): string => {
	const node = arena.nodes.get(id);

	if (!node) {
		return `e${id}`;
	}
	return node.args.length === 0 ? node.head : `${node.head}(${node.args.map(a => enodeName(arena, a)).join(", ")})`;
};

const allClassesStr = (classes: EqClass, arena: ArenaState): string =>
	[...classes.values()].map(members => `{${[...members].map(id => enodeName(arena, id)).join(", ")}}`).join("  ");

const initEqClasses = (arena: ArenaState): EqClass => new Map([...arena.nodes.keys()].map(id => [id, new Set([id])]));

const mergeClasses = (classes: EqClass, winner: EnodeId, loser: EnodeId): EqClass => {
	const winnerSet = classes.get(winner) ?? new Set([winner]);
	const loserSet = classes.get(loser) ?? new Set([loser]);
	const merged = new Set([...winnerSet, ...loserSet]);
	return new Map([...classes, [winner, merged] as const].filter(([id]) => id !== loser));
};

type EUFReplayState = { readonly classes: EqClass; readonly initialized: boolean };

type EUFStepResult = { readonly lines: readonly string[]; readonly state: EUFReplayState };

const atomDesc = (literal: Literal, atoms: AtomTable): string => {
	const v = Math.abs(literal);
	const info = atoms.get(v);

	if (!info) {
		return "";
	}
	return `(${info.op} ${Print.term(info.args[0])} ${Print.term(info.args[1])})`;
};

const replayEUFStep = (step: EUFTrace.Step, euf: EUFReplayState, arena: ArenaState, name: Namer, atoms: AtomTable): EUFStepResult =>
	match(step)
		.with({ tag: "merge" }, ({ a, b, reason, winner, loser }) => {
			const next: EUFReplayState = { classes: mergeClasses(euf.classes, winner, loser), initialized: euf.initialized };
			return {
				lines: [
					`merge ${enodeName(arena, a)} ≡ ${enodeName(arena, b)}`.padEnd(REPLAY_COL_WIDTH) + `reason: ${name(reason)}`,
					`classes: ${allClassesStr(next.classes, arena)}`,
				],
				state: next,
			};
		})
		.with({ tag: "merge-skip" }, ({ root }) => ({
			lines: [`skip  ${enodeName(arena, root)} already equal`],
			state: euf,
		}))
		.with({ tag: "congruence" }, ({ pA, pB }) => ({
			lines: [`congruence ${enodeName(arena, pA)} ≅ ${enodeName(arena, pB)}`.padEnd(REPLAY_COL_WIDTH) + `reason: args in same class`],
			state: euf,
		}))
		.with({ tag: "conflict" }, ({ clause }) => {
			const symbolic = clause.literals.map(name).join(" v ");
			const expanded = clause.literals.map(l => expandedNamer(atoms)(l)).join(" v ");
			return {
				lines: [`${clause.origin}: ${symbolic} → ${expanded}`],
				state: euf,
			};
		})
		.with({ tag: "scan" }, ({ literal, equal }) => {
			const desc = atomDesc(literal, atoms);
			const expanded = desc ? `${name(literal)}: ${desc}` : name(literal);
			const v = Math.abs(literal);
			const info = atoms.get(v);
			const op = info?.op ?? "!=";
			return equal
				? {
						lines: [`classes: ${allClassesStr(euf.classes, arena)}`, `scan ${expanded}`.padEnd(REPLAY_COL_WIDTH) + `→ same class, contradicts ${op}`],
						state: euf,
					}
				: { lines: [`scan ${expanded}`.padEnd(REPLAY_COL_WIDTH) + `→ ok`], state: euf };
		})
		.exhaustive();

// --- Arithmetic replay state ---

type BoundsMap = ReadonlyMap<string, { readonly lower?: string; readonly upper?: string }>;

type ArithReplayState = { readonly bounds: BoundsMap };

const boundsStr = (bounds: BoundsMap, atoms: AtomTable): string => {
	const entries = [...bounds.entries()]
		.filter(([, b]) => b.lower !== undefined || b.upper !== undefined)
		.map(([v, b]) => {
			const lo = b.lower ?? "-∞";
			const hi = b.upper ?? "∞";
			return `${resolveVar(v, atoms)} ∈ [${lo}, ${hi}]`;
		});
	return entries.length === 0 ? "(no bounds)" : entries.join(", ");
};

const updateBound = (bounds: BoundsMap, variable: string, kind: "lower" | "upper", value: Rational, strict: boolean): BoundsMap => {
	const existing = bounds.get(variable) ?? {};
	const formatted = `${strict ? "(" : ""}${Rational.toString(value)}`;
	const updated = kind === "lower" ? { ...existing, lower: formatted } : { ...existing, upper: formatted };
	return new Map([...bounds, [variable, updated]]);
};

type ArithStepResult = { readonly lines: readonly string[]; readonly state: ArithReplayState };

const replayArithStep = (step: ArithTrace.Step, arith: ArithReplayState, atoms: AtomTable): ArithStepResult =>
	match(step)
		.with({ tag: "bound" }, ({ variable, kind, value, strict }) => {
			const next = { bounds: updateBound(arith.bounds, variable, kind, value, strict) };
			const resolved = resolveVar(variable, atoms);
			const assertion = `${resolved} ${kind === "lower" ? "≥" : "≤"} ${Rational.toString(value)}${strict ? " (strict)" : ""}`;
			return {
				lines: [`assert ${assertion}`.padEnd(REPLAY_COL_WIDTH) + `→  ${boundsStr(next.bounds, atoms)}`],
				state: next,
			};
		})
		.with({ tag: "bound-conflict" }, ({ variable, lower, upper }) => ({
			lines: [`conflict  ${resolveVar(variable, atoms)}: lower ${Rational.toString(lower)} > upper ${Rational.toString(upper)}`],
			state: arith,
		}))
		.with({ tag: "violation" }, ({ variable, value, direction }) => ({
			lines: [`violation  ${resolveVar(variable, atoms)} = ${Rational.toString(value)}, ${direction} its ${direction === "below" ? "lower" : "upper"} bound`],
			state: arith,
		}))
		.with({ tag: "pivot" }, ({ leaving, entering }) => ({
			lines: [`pivot  ${resolveVar(leaving, atoms)} ↔ ${resolveVar(entering, atoms)}`],
			state: arith,
		}))
		.with({ tag: "infeasible" }, ({ variable }) => ({
			lines: [`infeasible  no pivot candidate for ${resolveVar(variable, atoms)}`],
			state: arith,
		}))
		.with({ tag: "feasible" }, () => ({
			lines: [`feasible`],
			state: arith,
		}))
		.exhaustive();

// --- Slack variable resolution ---

const SLACK_RE = /^\$slack_(-?\d+)$/;

const resolveVar = (variable: string, atoms: AtomTable): string => {
	const m = SLACK_RE.exec(variable);

	if (!m) {
		return variable;
	}
	const lit = Math.abs(Number(m[1]));
	const info = atoms.get(lit);

	if (!info) {
		return variable;
	}
	return match(info.op)
		.with("=", () => `(${Print.term(info.args[0])} - ${Print.term(info.args[1])})`)
		.with("!=", () => `(${Print.term(info.args[0])} - ${Print.term(info.args[1])})`)
		.otherwise(() => Print.term(info.args[0]));
};

// --- Trail ---

const trailLine = (trail: readonly TrailEntry[], name: Namer): Doc => {
	const entries = trail.map(e => `${name(e.literal)}@${e.level}`);
	return trail.length === 0 ? [NL, "  trail: { }"] : [NL, `  trail: { ${entries.join(", ")} }`];
};

// --- Section builders ---

const render = (doc: Doc): string => PP.render(REPLAY_WIDTH, doc);

const proxyStr = (info: ProxyInfo, name: Namer): string => (info.operands.length === 0 ? info.op : `(${info.op} ${info.operands.map(name).join(" ")})`);

const atomsSection = (atoms: AtomTable, proxies: ProxyTable, name: Namer): Doc => {
	const atomEntries = [...atoms.entries()];
	const proxyEntries = [...proxies.entries()].filter(([v]) => !atoms.has(v));

	const atomLines: Doc =
		atomEntries.length === 0 ? [] : atomEntries.map(([v, info]) => [NL, `  p${v}: (${info.op} ${Print.term(info.args[0])} ${Print.term(info.args[1])})`]);

	const proxyLines: Doc = proxyEntries.length === 0 ? [] : proxyEntries.map(([v, info]) => [NL, `  proxy p${v}: ${proxyStr(info, name)}`]);

	const hasContent = atomEntries.length > 0 || proxyEntries.length > 0;

	return hasContent ? ["=== Variables ===", atomLines, proxyLines] : ["=== Variables ===", NL, "  (none)"];
};

const clauseStateDoc = (clauses: readonly Clause[], name: Namer, assignments: Assignments): Doc => {
	const maxLen = clauses.reduce((max, c) => Math.max(max, clauseWithValues(c, name, assignments).length), 0);

	const lines: Doc = clauses.map(c => {
		const rendered = clauseWithValues(c, name, assignments);
		const status = evalClause(c, assignments);
		const pad = " ".repeat(Math.max(1, maxLen - rendered.length + STATUS_GUTTER));
		return [NL, `  ${rendered}${pad}-> ${statusStr(status, name)}`];
	});

	return ["[clauses]", lines];
};

const clauseWithValues = (clause: Clause, name: Namer, assignments: Assignments): string =>
	`${clauseId(clause.id)}: ${clause.literals.map(l => litWithValue(l, name, assignments)).join(" v ")}`;

// --- Small-step clause evaluation ---

type LitValue = "true" | "false" | "unassigned";

const evalLit = (lit: Literal, assignments: Assignments): LitValue => {
	const v = Math.abs(lit);
	const assigned = assignments.get(v);

	if (assigned === undefined) {
		return "unassigned";
	}
	const positive = lit > 0;
	return assigned === positive ? "true" : "false";
};

const litWithValue = (lit: Literal, name: Namer, assignments: Assignments): string => {
	const val = evalLit(lit, assignments);
	return val === "unassigned" ? name(lit) : val;
};

type ClauseStatus =
	| { readonly tag: "satisfied" }
	| { readonly tag: "unit"; readonly literal: Literal }
	| { readonly tag: "empty" }
	| { readonly tag: "open"; readonly remaining: number };

const evalClause = (clause: Clause, assignments: Assignments): ClauseStatus => {
	const summarize = (unassigned: readonly Literal[]): ClauseStatus =>
		unassigned.length === 0
			? { tag: "empty" }
			: unassigned.length === 1
				? { tag: "unit", literal: unassigned[0] }
				: { tag: "open", remaining: unassigned.length };

	const go = (remaining: readonly Literal[], unassigned: readonly Literal[]): ClauseStatus => {
		if (remaining.length === 0) {
			return summarize(unassigned);
		}
		const [lit, ...rest] = remaining;
		return match(evalLit(lit, assignments))
			.with("true", (): ClauseStatus => ({ tag: "satisfied" }))
			.with("false", () => go(rest, unassigned))
			.with("unassigned", () => go(rest, [...unassigned, lit]))
			.exhaustive();
	};

	return go(clause.literals, []);
};

const statusStr = (status: ClauseStatus, name: Namer): string =>
	match(status)
		.with({ tag: "satisfied" }, () => "satisfied")
		.with({ tag: "unit" }, ({ literal }) => `unit: ${name(literal)}`)
		.with({ tag: "empty" }, () => "empty!")
		.with({ tag: "open" }, ({ remaining }) => `${remaining} open`)
		.exhaustive();

// --- Literal / clause rendering ---

type Namer = (lit: Literal) => string;

const expandedNamer =
	(atoms: AtomTable): Namer =>
	(lit: Literal) => {
		const v = Math.abs(lit);
		const sign = lit > 0 ? "" : "~";
		const info = atoms.get(v);
		return info ? `${sign}(${info.op} ${Print.term(info.args[0])} ${Print.term(info.args[1])})` : `${sign}p${v}`;
	};

const symbolicNamer: Namer = (lit: Literal) => {
	const v = Math.abs(lit);
	return lit > 0 ? `p${v}` : `~p${v}`;
};

const mkNamer = (mode: ReplayMode, atoms: AtomTable): Namer => (mode === "symbolic" ? symbolicNamer : expandedNamer(atoms));

const clauseId = (id: number): string => (id < 0 ? `T${-id}` : `#${id}`);
const clauseStr = (clause: Clause, name: Namer): string => `${clauseId(clause.id)}: ${clause.literals.map(name).join(" v ")}`;

const formatSubstitution = (sub: ReadonlyMap<string, string>): string => [...sub.entries()].map(([k, v]) => `${k}=${v}`).join(", ");

// legacy litName for Trace.print/format (always expanded)
const litName = (lit: Literal, atoms: AtomTable): string => expandedNamer(atoms)(lit);
