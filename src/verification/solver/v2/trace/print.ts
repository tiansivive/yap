import { match } from "ts-pattern";
import { Print } from "../../ivl/print";
import type * as CDCL from "../cdcl";
import type * as Encoding from "../encoding";
import type { Event } from "../trace";

export const print = (step: Event.T, encoding: Encoding.State = Empty.encoding): string =>
	match(step)
		.with({ tag: "propagate" }, ({ literal, reason }) => `[propagate] ${literal_(literal, encoding)} by ${clause(reason, encoding)}`)
		.with({ tag: "conflict" }, ({ clause: c }) => `[conflict] ${clause(c, encoding)}`)
		.with({ tag: "decide" }, ({ literal, level }) => `[decide] ${literal_(literal, encoding)} at ${level}`)
		.with({ tag: "analyze" }, ({ learned, backtrackLevel }) => `[analyze] ${clause(learned, encoding)} -> ${backtrackLevel}`)
		.with({ tag: "backjump" }, ({ from, to }) => `[backjump] ${from} -> ${to}`)
		.with({ tag: "assert" }, ({ theory, literal, result }) => `[theory] ${theory} assert ${literal_(literal, encoding)}: ${result}`)
		.with({ tag: "check" }, ({ theory, result }) => `[theory] ${theory} check: ${result}`)
		.with({ tag: "enter" }, ({ level }) => `[theory] enter ${level}`)
		.with({ tag: "backtrack" }, ({ to }) => `[theory] backtrack ${to}`)
		.with({ tag: "round" }, ({ round, lemmas }) => `[quantifier] round ${round}: ${lemmas} lemmas`)
		.with({ tag: "mbqi" }, ({ round, instantiations }) => `[mbqi] round ${round}: ${instantiations.map(sample).join(", ") || "none"}`)
		.with({ tag: "pure" }, ({ quantifiers }) => `[quantifier] pure ${quantifiers}`)
		.with({ tag: "sat" }, () => "[sat]")
		.with({ tag: "unsat" }, ({ core }) => `[unsat] ${core.map(c => c.origin).join(", ")}`)
		.with({ tag: "unknown" }, ({ reason }) => `[unknown] ${reason}`)
		.exhaustive();

export const format = (steps: Event.T[], encoding: Encoding.State = Empty.encoding): string => steps.map(step => print(step, encoding)).join("\n");

const Empty = {
	encoding: {
		clauses: [],
		keyIndex: new Map(),
		atoms: new Map(),
		proxies: new Map(),
		nextVar: 1,
	} satisfies Encoding.State,
};

const sample = (s: { substitution: Map<string, string>; simplification: { tag: string } }): string =>
	`${[...s.substitution.entries()].map(([name, value]) => `${name}=${value}`).join(",") || "empty"}:${s.simplification.tag}`;

const clause = (clause: CDCL.Clause.T, encoding: Encoding.State): string => `[${clause.literals.map(lit => literal_(lit, encoding)).join(" v ")}]`;

const literal_ = (literal: CDCL.Literal, encoding: Encoding.State): string =>
	match(encoding.atoms.get(Math.abs(literal)))
		.with(undefined, () => literal.toString())
		.otherwise(atom => `${sign(literal)}${atom.op} ${Print.term(atom.args[0])} ${Print.term(atom.args[1])}`);

const sign = (literal: CDCL.Literal): string =>
	match(literal < 0)
		.with(true, () => "not ")
		.with(false, () => "")
		.exhaustive();
