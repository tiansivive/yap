import { match, P } from "ts-pattern";
import { Print as IVLPrint } from "../../ivl/print";
import * as CDCL from "../cdcl";
import * as Encoding from "../encoding";
import type * as ArithmeticDomain from "../arithmetic";
import type * as EUFDomain from "../euf";
import type * as TheoryDomain from "../theory";
import { Rational } from "../arithmetic";
import type { Event } from "./index";

export const replay = (opts: Options): string => {
	const showRegistry = opts.showRegistry ?? true;
	const initial = Replay.initial(opts.encoding);
	const sections = [
		"=== Formula ===",
		indent(opts.formula),
		"",
		variables(opts.encoding),
		...match(showRegistry)
			.with(true, () => ["", registry(opts.encoding)])
			.with(false, () => [])
			.exhaustive(),
		"",
		"=== Trace ===",
		clauses(initial.allClauses, initial.assignments, opts.encoding),
	];
	const result = opts.steps.reduce<Replay.Result>(
		(acc, step) => {
			const next = Replay.step(acc.state, step, opts);
			return { state: next.state, lines: [...acc.lines, ...next.lines] };
		},
		{ state: initial, lines: [] },
	);
	return [...sections, ...result.lines].join("\n");
};

export type Options = {
	formula: string;
	steps: Event.T[];
	encoding: Encoding.State;
	arena?: EUFDomain.Arena.State;
	showRegistry?: boolean;
};

namespace Replay {
	export type State = {
		trail: Trail.Entry[];
		assignments: Map<CDCL.Variable, boolean>;
		allClauses: CDCL.Clause.T[];
		euf: ReplayEUF.State;
		arithmetic: ReplayArithmetic.State;
	};

	export type Result = {
		state: State;
		lines: string[];
	};

	export const initial = (encoding: Encoding.State): State => ({
		trail: [],
		assignments: new Map(),
		allClauses: encoding.clauses,
		euf: { classes: new Map(), initialized: false },
		arithmetic: { bounds: new Map() },
	});

	export const step = (state: State, step: Event.T, opts: Options): Result =>
		match(step)
			.with({ tag: "decide" }, ({ literal, level }) =>
				assign("decide", `${literal_(literal, opts.encoding)} = ${truth(literal)} (level ${level})`, literal, level, "decision", state, opts),
			)
			.with({ tag: "propagate" }, ({ literal, reason }) =>
				assign(
					"propagate",
					`${literal_(literal, opts.encoding)} = ${truth(literal)} (forced by ${clause(reason, state.allClauses, opts.encoding)})`,
					literal,
					Trail.level(state),
					clause(reason, state.allClauses, opts.encoding),
					state,
					opts,
				),
			)
			.with({ tag: "conflict" }, ({ clause: c }) => ({
				state,
				lines: ["", `[conflict] ${clause(c, state.allClauses, opts.encoding)} -- all literals false`],
			}))
			.with({ tag: "analyze" }, ({ conflict, learned, backtrackLevel }) => ({
				state: { ...state, allClauses: [...state.allClauses, learned] },
				lines: [
					"",
					"[analyze]",
					`  conflict  ${clause(conflict, state.allClauses, opts.encoding)}`,
					`  learned   ${clause(learned, [...state.allClauses, learned], opts.encoding)}`,
					`  backjump -> level ${backtrackLevel}`,
				],
			}))
			.with({ tag: "backjump" }, ({ from, to }) => {
				const next = Trail.backtrack(state, to);
				return { state: next, lines: ["", `[backjump] level ${from} -> ${to}`, trail(next), clauses(next.allClauses, next.assignments, opts.encoding)] };
			})
			.with({ tag: "assert" }, ({ theory, literal, result, detail }) => {
				const rendered = Theory.render(state, detail, opts);
				return {
					state: { ...state, euf: rendered.euf, arithmetic: rendered.arithmetic },
					lines: ["", `[theory] ${theory} assert ${literal_(literal, opts.encoding)}: ${result}`, ...rendered.lines],
				};
			})
			.with({ tag: "check" }, ({ theory, result, detail }) => {
				const rendered = Theory.render(state, detail, opts);
				return {
					state: { ...state, euf: rendered.euf, arithmetic: rendered.arithmetic },
					lines: ["", `[theory] ${theory} check: ${result}`, ...rendered.lines],
				};
			})
			.with({ tag: "enter" }, ({ level }) => ({ state, lines: ["", `[theory] enter level ${level}`] }))
			.with({ tag: "backtrack" }, ({ to }) => ({ state: Trail.backtrack(state, to), lines: ["", `[theory] backtrack -> level ${to}`] }))
			.with({ tag: "round" }, ({ round, lemmas }) => Quantifier.render(state, "quantifier", round, lemmas, opts))
			.with({ tag: "mbqi" }, ({ round, lemmas, instantiations }) => Quantifier.render(state, "mbqi", round, lemmas, opts, instantiations.map(sample)))
			.with({ tag: "pure" }, ({ quantifiers }) => ({ state, lines: ["", `[quantifier] pure path: ${quantifiers} quantifier(s)`] }))
			.with({ tag: "sat" }, () => ({ state, lines: ["", "[sat]"] }))
			.with({ tag: "unsat" }, ({ core }) => ({ state, lines: ["", `[unsat] core: [${core.map(c => label(c, state.allClauses)).join(", ")}]`] }))
			.with({ tag: "unknown" }, ({ reason }) => ({ state, lines: ["", `[unknown] ${reason}`] }))
			.exhaustive();
}

namespace Trail {
	export type Entry = { literal: CDCL.Literal; level: number; reason: string };

	export const level = (state: Replay.State): number => state.trail.at(-1)?.level ?? 0;

	export const backtrack = (state: Replay.State, level: number): Replay.State => {
		const trail = state.trail.filter(entry => entry.level <= level);
		const assignments = trail.reduce<Map<CDCL.Variable, boolean>>(
			(acc, entry) => new Map([...acc, [CDCL.Literal.variable(entry.literal), CDCL.Literal.polarity(entry.literal)]]),
			new Map(),
		);
		return { ...state, trail, assignments };
	};
}

namespace Theory {
	export type Rendered = {
		lines: string[];
		euf: ReplayEUF.State;
		arithmetic: ReplayArithmetic.State;
	};

	export const render = (state: Replay.State, events: readonly TheoryDomain.Event.Local[], opts: Options): Rendered =>
		events.reduce<Rendered>(
			(acc, event) =>
				match(event)
					.with({ tag: "euf" }, ({ event }) => {
						const rendered = ReplayEUF.render(acc.euf, event, opts);
						return { ...acc, euf: rendered.state, lines: [...acc.lines, ...rendered.lines] };
					})
					.with({ tag: "arithmetic" }, ({ event }) => {
						const rendered = ReplayArithmetic.render(acc.arithmetic, event, opts);
						return { ...acc, arithmetic: rendered.state, lines: [...acc.lines, ...rendered.lines] };
					})
					.exhaustive(),
			{ lines: [], euf: state.euf, arithmetic: state.arithmetic },
		);
}

namespace ReplayEUF {
	export type Classes = Map<EUFDomain.Enode.Id, Set<EUFDomain.Enode.Id>>;

	export type State = {
		classes: Classes;
		initialized: boolean;
	};

	export type Rendered = {
		lines: string[];
		state: State;
	};

	export const render = (state: State, event: EUFDomain.Event, opts: Options): Rendered => {
		const prepared = init(state, opts.arena);
		const line = (text: string): string => `  ${text}`;
		return match(event)
			.with({ tag: "active" }, ({ literal }) => ({ state: prepared.state, lines: [...prepared.lines, line(`active ${literal_(literal, opts.encoding)}`)] }))
			.with({ tag: "merge" }, ({ a, b, reason }) => {
				const classes = merge(prepared.state.classes, a, b);
				return {
					state: { ...prepared.state, classes },
					lines: [
						...prepared.lines,
						line(`merge ${name(opts.arena, a)} = ${name(opts.arena, b)}    reason: ${literal_(reason, opts.encoding)}`),
						line(`classes: ${classes_(classes, opts.arena)}`),
					],
				};
			})
			.with({ tag: "skip" }, ({ root }) => ({ state: prepared.state, lines: [...prepared.lines, line(`skip ${name(opts.arena, root)} already equal`)] }))
			.with({ tag: "congruence" }, ({ left, right }) => ({
				state: prepared.state,
				lines: [...prepared.lines, line(`congruence ${name(opts.arena, left)} ~= ${name(opts.arena, right)}`)],
			}))
			.with({ tag: "scan" }, ({ literal, equal }) => ({
				state: prepared.state,
				lines: [...prepared.lines, line(`scan active ${literal_(literal, opts.encoding)} -> ${equal ? "same class, conflict" : "ok"}`)],
			}))
			.with({ tag: "conflict" }, ({ clause: c }) => ({
				state: prepared.state,
				lines: [...prepared.lines, line(`${c.origin}: ${c.literals.map(l => literal_(l, opts.encoding)).join(" v ")}`)],
			}))
			.exhaustive();
	};

	const init = (state: State, arena: EUFDomain.Arena.State | undefined): Rendered =>
		match([state.initialized, arena] as const)
			.with([false, undefined], () => ({ state: { ...state, initialized: true }, lines: [] }))
			.with([false, { nodes: P.select() }], nodes => {
				const classes = new Map<EUFDomain.Enode.Id, Set<EUFDomain.Enode.Id>>([...nodes.keys()].map(id => [id, new Set([id])]));
				return { state: { classes, initialized: true }, lines: [`  classes: ${classes_(classes, arena)}`] };
			})
			.otherwise(() => ({ state, lines: [] }));

	const merge = (classes: Classes, a: EUFDomain.Enode.Id, b: EUFDomain.Enode.Id): Classes => {
		const left = root(classes, a);
		const right = root(classes, b);
		const merged = new Set([...(classes.get(left) ?? new Set([left])), ...(classes.get(right) ?? new Set([right]))]);
		return match(left === right)
			.with(true, () => classes)
			.with(false, () => new Map<EUFDomain.Enode.Id, Set<EUFDomain.Enode.Id>>([...classes, [left, merged] as const].filter(([id]) => id !== right)))
			.exhaustive();
	};

	const root = (classes: Classes, id: EUFDomain.Enode.Id): EUFDomain.Enode.Id => [...classes.entries()].find(([, members]) => members.has(id))?.[0] ?? id;

	const classes_ = (classes: Classes, arena: EUFDomain.Arena.State | undefined): string =>
		[...classes.values()].map(members => `{${[...members].map(id => name(arena, id)).join(", ")}}`).join("  ");

	const name = (arena: EUFDomain.Arena.State | undefined, id: EUFDomain.Enode.Id): string =>
		match(arena?.nodes.get(id))
			.with(undefined, () => `e${id}`)
			.otherwise(node =>
				match(node.args)
					.with([], () => node.head)
					.otherwise(args => `${node.head}(${args.map(arg => name(arena, arg)).join(", ")})`),
			);
}

namespace ReplayArithmetic {
	export type Bounds = Map<string, { lower?: string; upper?: string }>;

	export type State = {
		bounds: Bounds;
	};

	export type Rendered = {
		lines: string[];
		state: State;
	};

	export const render = (state: State, event: ArithmeticDomain.Event, opts: Options): Rendered =>
		match(event)
			.with({ tag: "bound" }, ({ variable, bound, direction }) => {
				const next = { bounds: set(state.bounds, variable, direction, Rational.toString(bound.value)) };
				return {
					state: next,
					lines: [
						`  assert ${resolve(variable, opts.encoding)} ${direction === "lower" ? ">=" : "<="} ${Rational.toString(bound.value)} -> ${bounds(next.bounds, opts.encoding)}`,
					],
				};
			})
			.with({ tag: "conflict" }, ({ variable }) => ({ state, lines: [`  conflict ${resolve(variable, opts.encoding)}`] }))
			.with({ tag: "violation" }, ({ variable, direction }) => ({ state, lines: [`  violation ${resolve(variable, opts.encoding)} ${direction}`] }))
			.with({ tag: "pivot" }, ({ leaving, entering }) => ({
				state,
				lines: [`  pivot ${resolve(leaving, opts.encoding)} <-> ${resolve(entering, opts.encoding)}`],
			}))
			.with({ tag: "infeasible" }, ({ variable }) => ({ state, lines: [`  infeasible no pivot candidate for ${resolve(variable, opts.encoding)}`] }))
			.with({ tag: "feasible" }, () => ({ state, lines: ["  feasible"] }))
			.exhaustive();

	const set = (bounds: Bounds, variable: string, direction: "lower" | "upper", value: string): Bounds => {
		const current = bounds.get(variable) ?? {};
		return new Map([...bounds, [variable, { ...current, [direction]: value }]]);
	};

	const bounds = (bounds: Bounds, encoding: Encoding.State): string =>
		match([...bounds.entries()].filter(([, bound]) => bound.lower !== undefined || bound.upper !== undefined))
			.with([], () => "(no bounds)")
			.otherwise(entries =>
				entries.map(([variable, bound]) => `${resolve(variable, encoding)} in [${bound.lower ?? "-inf"}, ${bound.upper ?? "inf"}]`).join(", "),
			);

	const resolve = (variable: string, encoding: Encoding.State): string =>
		match(/^\$slack_(-?\d+)$/.exec(variable))
			.with(P.nonNullable, ([, lit]) =>
				match(encoding.atoms.get(Math.abs(Number(lit))))
					.with(undefined, () => variable)
					.otherwise(() => `$slack(${literal_(Math.abs(Number(lit)), encoding)})`),
			)
			.otherwise(() => variable);
}

namespace Quantifier {
	export const render = (
		state: Replay.State,
		tag: "quantifier" | "mbqi",
		round: number,
		lemmas: { clause: CDCL.Clause.T; origin: string; generation: number; source: { tag: string } }[],
		opts: Options,
		details: string[] = [],
	): Replay.Result => {
		const added = lemmas.map(lemma => lemma.clause);
		const next = { ...state, trail: [], assignments: new Map(), allClauses: [...state.allClauses, ...added] };
		const lemmaLines = lemmas.map(lemma => `  lemma ${lemma.source.tag}:${lemma.origin}: ${clause(lemma.clause, next.allClauses, opts.encoding)}`);
		return {
			state: next,
			lines: [
				"",
				`[${tag}] round ${round}: ${lemmas.length} lemmas`,
				...details.map(detail => `  ${detail}`),
				...lemmaLines,
				clauses(next.allClauses, next.assignments, opts.encoding),
			],
		};
	};
}

const variables = (encoding: Encoding.State): string =>
	[
		"=== Variables ===",
		...[...encoding.atoms.entries()].map(([literal, atom]) => `  p${literal}: ${atom.op} ${IVLPrint.term(atom.args[0])} ${IVLPrint.term(atom.args[1])}`),
		...[...encoding.proxies.entries()].filter(([v]) => !encoding.atoms.has(v)).map(([variable, proxy]) => `  proxy p${variable}: ${proxy_(proxy)}`),
	].join("\n");

const registry = (encoding: Encoding.State): string =>
	[
		"=== Registry ===",
		...[...encoding.atoms.entries()].flatMap(([literal, atom]) => [registryLine(literal, atom, true), registryLine(-literal, atom, false)]),
	].join("\n");

const registryLine = (literal: CDCL.Literal, atom: Encoding.Atom.T, positive: boolean): string =>
	`  ${literal_(literal, { ...Encoding.State.empty, atoms: new Map([[Math.abs(literal), atom]]) })}: euf ${euf(atom.op, positive)} ${IVLPrint.term(atom.args[0])} ${IVLPrint.term(atom.args[1])}; arithmetic ${arith(atom.op, positive)}`;

const euf = (op: Encoding.Atom.T["op"], positive: boolean): string =>
	match([op, positive])
		.with(["=", true], () => "=")
		.with(["=", false], () => "!=")
		.with(["!=", true], () => "!=")
		.with(["!=", false], () => "=")
		.otherwise(() => "(none)");

const arith = (op: Encoding.Atom.T["op"], positive: boolean): string => (positive ? op : `not ${op}`);

const proxy_ = (proxy: Encoding.Proxy): string =>
	match(proxy.operands)
		.with([], () => proxy.tag)
		.otherwise(operands => `${proxy.tag} ${operands.map(symbolic).join(" ")}`);

const assign = (tag: string, body: string, literal: CDCL.Literal, level: number, reason: string, state: Replay.State, opts: Options): Replay.Result => {
	const next = {
		...state,
		trail: [...state.trail, { literal, level, reason }],
		assignments: new Map([...state.assignments, [CDCL.Literal.variable(literal), CDCL.Literal.polarity(literal)]]),
	};
	return { state: next, lines: ["", `[${tag}] ${body}`, trail(next), clauses(next.allClauses, next.assignments, opts.encoding)] };
};

const clauses = (clauses: CDCL.Clause.T[], assignments: Map<CDCL.Variable, boolean>, encoding: Encoding.State): string =>
	["[clauses]", ...clauses.map(c => `  ${clauseWithValues(c, clauses, assignments, encoding)} -> ${status(c, assignments, encoding)}`)].join("\n");

const clause = (clause: CDCL.Clause.T, clauses: CDCL.Clause.T[], encoding: Encoding.State): string =>
	`${label(clause, clauses)}: ${clause.literals.map(literal => literal_(literal, encoding)).join(" v ")} (${clause.origin})`;

const clauseWithValues = (clause: CDCL.Clause.T, clauses: CDCL.Clause.T[], assignments: Map<CDCL.Variable, boolean>, encoding: Encoding.State): string =>
	`${label(clause, clauses)}: ${clause.literals.map(literal => value(literal, assignments, encoding)).join(" v ")}`;

const label = (clause: CDCL.Clause.T, clauses: CDCL.Clause.T[]): string =>
	`#${Math.max(
		0,
		clauses.findIndex(c => key(c) === key(clause)),
	)}`;

const key = (clause: CDCL.Clause.T): string => `${clause.origin}:${clause.literals.join(",")}`;

const status = (clause: CDCL.Clause.T, assignments: Map<CDCL.Variable, boolean>, encoding: Encoding.State): string =>
	match(clause.literals.filter(literal => assigned(literal, assignments) === undefined))
		.when(
			() => clause.literals.some(literal => assigned(literal, assignments) === CDCL.Literal.polarity(literal)),
			() => "satisfied",
		)
		.with([], () => "empty!")
		.with([P.select()], literal => `unit: ${literal_(literal, encoding)}`)
		.otherwise(literals => `${literals.length} open`);

const value = (literal: CDCL.Literal, assignments: Map<CDCL.Variable, boolean>, encoding: Encoding.State): string =>
	match(assigned(literal, assignments))
		.with(undefined, () => literal_(literal, encoding))
		.otherwise(value => (value === CDCL.Literal.polarity(literal) ? "true" : "false"));

const assigned = (literal: CDCL.Literal, assignments: Map<CDCL.Variable, boolean>): boolean | undefined => assignments.get(CDCL.Literal.variable(literal));

const trail = (state: Replay.State): string =>
	match(state.trail)
		.with([], () => "  trail: { }")
		.otherwise(entries => `  trail: { ${entries.map(entry => `${symbolic(entry.literal)}@${entry.level}`).join(", ")} }`);

const literal_ = (literal: CDCL.Literal, encoding: Encoding.State): string =>
	match(encoding.atoms.get(Math.abs(literal)))
		.with(undefined, () => symbolic(literal))
		.otherwise(atom => `${literal < 0 ? "~" : ""}(${atom.op} ${IVLPrint.term(atom.args[0])} ${IVLPrint.term(atom.args[1])})`);

const symbolic = (literal: CDCL.Literal): string => `${literal < 0 ? "~" : ""}p${Math.abs(literal)}`;

const truth = (literal: CDCL.Literal): string => (literal > 0 ? "true" : "false");

const sample = (s: { substitution: Map<string, string>; simplification: { tag: string } }): string =>
	`${[...s.substitution.entries()].map(([name, value]) => `${name}=${value}`).join(",") || "empty"} -> ${s.simplification.tag}`;

const indent = (text: string): string =>
	text
		.split("\n")
		.map(line => `  ${line}`)
		.join("\n");
