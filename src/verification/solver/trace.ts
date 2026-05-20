// Solver trace: step-by-step event type and consumer utilities.
// Enables observable CDCL(T) execution — silent, logged, or interactive.

import * as PP from "prettier-printer";
import { match } from "ts-pattern";
import { Print } from "./ivl/print";
import type { Clause, Literal, Variable, Assignment } from "./cdcl/core";
import type { AtomInfo, ProxyInfo, CNFResult } from "./cnf";

export type Step =
	| { readonly tag: "propagate"; readonly literal: Literal; readonly reason: Clause }
	| { readonly tag: "conflict"; readonly clause: Clause }
	| { readonly tag: "decide"; readonly literal: Literal; readonly level: number }
	| { readonly tag: "theory-assert"; readonly theory: string; readonly literal: Literal; readonly result: "ok" | "conflict" }
	| { readonly tag: "theory-check"; readonly theory: string; readonly result: "ok" | "conflict" }
	| { readonly tag: "theory-push"; readonly level: number }
	| { readonly tag: "theory-pop"; readonly to: number }
	| { readonly tag: "analyze"; readonly conflict: Clause; readonly learned: Clause; readonly backtrackLevel: number }
	| { readonly tag: "backjump"; readonly from: number; readonly to: number }
	| { readonly tag: "quantifier-round"; readonly round: number; readonly lemmas: number }
	| { readonly tag: "sat"; readonly assignments: ReadonlyMap<Variable, Assignment> }
	| { readonly tag: "unsat"; readonly core: readonly Clause[] };

type AtomTable = ReadonlyMap<Literal, AtomInfo>;
type ProxyTable = ReadonlyMap<Variable, ProxyInfo>;
type Doc = PP.IDoc;
type Assignments = ReadonlyMap<Variable, boolean>;

export type ReplayMode = "symbolic" | "expanded";

const NL = PP.line;
const BLANK = [NL, NL];

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

const clauseStr = (clause: Clause, name: Namer): string => `#${clause.id}: ${clause.literals.map(name).join(" v ")}`;

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
	const unassigned: Literal[] = [];
	for (const lit of clause.literals) {
		const val = evalLit(lit, assignments);

		if (val === "true") {
			return { tag: "satisfied" };
		}

		if (val === "unassigned") {
			unassigned.push(lit);
		}
	}

	if (unassigned.length === 0) {
		return { tag: "empty" };
	}

	if (unassigned.length === 1) {
		return { tag: "unit", literal: unassigned[0] };
	}
	return { tag: "open", remaining: unassigned.length };
};

const statusStr = (status: ClauseStatus, name: Namer): string =>
	match(status)
		.with({ tag: "satisfied" }, () => "satisfied")
		.with({ tag: "unit" }, ({ literal }) => `unit: ${name(literal)}`)
		.with({ tag: "empty" }, () => "empty!")
		.with({ tag: "open" }, ({ remaining }) => `${remaining} open`)
		.exhaustive();

// --- Section builders ---

const REPLAY_WIDTH = 120;

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
		const pad = " ".repeat(Math.max(1, maxLen - rendered.length + 2));
		return [NL, `  ${rendered}${pad}-> ${statusStr(status, name)}`];
	});

	return ["[clauses]", lines];
};

const clauseWithValues = (clause: Clause, name: Namer, assignments: Assignments): string =>
	`#${clause.id}: ${clause.literals.map(l => litWithValue(l, name, assignments)).join(" v ")}`;

// --- Trail ---

type TrailEntry = { readonly literal: Literal; readonly level: number; readonly reason: string };

const trailLine = (trail: readonly TrailEntry[], name: Namer): Doc => {
	const entries = trail.map(e => `${name(e.literal)}@${e.level}`);
	return trail.length === 0 ? [NL, "  trail: { }"] : [NL, `  trail: { ${entries.join(", ")} }`];
};

// --- Replay state machine ---

type ReplayState = {
	readonly trail: readonly TrailEntry[];
	readonly assignments: Assignments;
	readonly allClauses: readonly Clause[];
};

const assignLit = (assignments: Assignments, lit: Literal): Assignments => new Map([...assignments, [Math.abs(lit), lit > 0]]);

const unassignAbove = (state: ReplayState, level: number): ReplayState => {
	const trail = state.trail.filter(e => e.level <= level);
	const assignments: Assignments = trail.reduce((acc, e) => assignLit(acc, e.literal), new Map() as Assignments);
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

const replayStep = (step: Step, name: Namer, state: ReplayState): { readonly docs: Doc; readonly state: ReplayState } =>
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
				`#${reason.id}`,
				name,
				state,
			);
		})
		.with({ tag: "conflict" }, ({ clause }) => ({
			docs: [NL, `[conflict]  ${clauseStr(clause, name)} — all literals false`],
			state,
		}))
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
		.with({ tag: "theory-assert" }, ({ theory, literal, result }) => ({
			docs: [NL, `[theory]  ${theory} assert ${name(literal)}: ${result}`],
			state,
		}))
		.with({ tag: "theory-check" }, ({ theory, result }) => ({
			docs: [NL, `[theory]  ${theory} check: ${result}`],
			state,
		}))
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
		.with({ tag: "sat" }, () => ({
			docs: [NL, "[sat]"],
			state,
		}))
		.with({ tag: "unsat" }, ({ core }) => ({
			docs: [NL, `[unsat]  core: [${core.map(c => `#${c.id}`).join(", ")}]`],
			state,
		}))
		.exhaustive();

// legacy litName for Trace.print/format (always expanded)
const litName = (lit: Literal, atoms: AtomTable): string => expandedNamer(atoms)(lit);

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
			.with({ tag: "sat" }, () => `[sat]`)
			.with({ tag: "unsat" }, ({ core }) => `[unsat]      core: [${core.map(c => `#${c.id}`).join(", ")}]`)
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
		readonly mode?: ReplayMode;
	}): string => {
		const { formula, steps, atoms, proxies, clauses, mode = "symbolic" } = opts;
		const name = mkNamer(mode, atoms);

		const initialState: ReplayState = { trail: [], assignments: new Map(), allClauses: clauses };

		const preamble: Doc = [
			"=== Formula ===",
			NL,
			`  ${formula}`,
			BLANK,
			atomsSection(atoms, proxies, name),
			BLANK,
			clauseStateDoc(clauses, name, new Map()),
			NL,
		];

		const fold = (remaining: readonly Step[], state: ReplayState, acc: Doc[]): Doc[] =>
			remaining.length === 0
				? acc
				: (() => {
						const { docs, state: next } = replayStep(remaining[0], name, state);
						return fold(remaining.slice(1), next, [...acc, docs]);
					})();

		const doc: Doc = [preamble, ...fold(steps, initialState, [])];
		return render(doc);
	},

	fromCNF: (cnfResult: CNFResult): AtomTable => cnfResult.atoms,
};
