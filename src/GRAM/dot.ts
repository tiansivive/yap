import type { Graph, Edge, Node, Payload } from "./graph";
import { isStructural } from "./vocabulary";
import { match, P } from "ts-pattern";

// ── Payload ──

const payload = (p: Payload): string => {
	const keys = Object.keys(p);
	return keys.length > 0 ? ` ${JSON.stringify(p)}` : "";
};

const escape = (s: string): string => s.replace(/"/g, '\\"');

// ── Node labels ──

const summary = (p: Payload): string =>
	match(p)
		.with({ variable: P.string }, p => String(p.variable))
		.with({ name: P.string }, p => String(p.name))
		.with({ label: P.string }, p => String(p.label))
		.with({ op: P.string }, p => String(p.op))
		.with({ value: P.any }, p => JSON.stringify(p.value))
		.otherwise(() => "<unknown payload>");

const label = (n: Node): string => {
	const s = summary(n.payload);
	return escape(s ? `${n.tag} ${s}` : n.tag);
};

// ── Colors ──

const Colors = {
	root: "#e8e8e8",
	variable: "#d4e6f1",
	pattern: "#d5f5e3",
	row: "#fdebd0",
	statement: "#fadbd8",
	type: "#e8daef",
	binder: "#fcf3cf",
	control: "#d5f5e3",
	closure: "#fadbd8",
	default: "#ffffff",
} as const;

const fill = (tag: string): string =>
	match(tag)
		.when(
			t => t === "root",
			() => Colors.root,
		)
		.when(
			t => t.startsWith("var:"),
			() => Colors.variable,
		)
		.when(
			t => t.startsWith("pat:"),
			() => Colors.pattern,
		)
		.when(
			t => t.startsWith("row:"),
			() => Colors.row,
		)
		.when(
			t => t.startsWith("stmt:"),
			() => Colors.statement,
		)
		.when(
			t => t.startsWith("type:"),
			() => Colors.type,
		)
		.when(
			t => ["lambda", "pi", "sigma", "mu", "let"].includes(t),
			() => Colors.binder,
		)
		.when(
			t => ["match", "case", "switch", "leaf", "fail"].includes(t),
			() => Colors.control,
		)
		.when(
			t => ["closure", "env"].includes(t),
			() => Colors.closure,
		)
		.otherwise(() => Colors.default);

// ── Edges ──

const edgeAttrs = (e: Edge): string => {
	const structural = isStructural(e.label);
	const lbl = escape(`${e.label}${payload(e.payload)}`);
	const color = structural ? "#333333" : "#888888";
	const style = structural ? "solid" : "dashed";
	return `label="${lbl}", color="${color}", style="${style}", fontsize=8, fontcolor="#666666"`;
};

// ── Graph ──

const sorted = (g: Graph): ReadonlyArray<Node> => [...g.nodes.values()].sort((a, b) => a.id - b.id);

const edges = (g: Graph, n: Node): ReadonlyArray<string> => {
	const out = g.edges.get(n.id);

	if (!out) {
		return [];
	}
	return [...out.values()].flat().map(e => `  n${e.source} -> n${e.target} [${edgeAttrs(e)}];`);
};

const d = {
	graph: (g: Graph): string => {
		const ns = sorted(g);
		const nodes = ns.map(n => `  n${n.id} [label="${label(n)}", fillcolor="${fill(n.tag)}"];`);
		const es = ns.flatMap(n => edges(g, n));
		return ["digraph GRAM {", "  rankdir=TB;", '  node [shape=box, style="rounded,filled", fontname="monospace", fontsize=10];', ...nodes, "", ...es, "}"].join(
			"\n",
		);
	},
};

export const dot = d.graph;
