import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId, Payload } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";

const PASS = { created_by: "pattern" } as const;

// ── Types ──

type Binding = { readonly binder: NodeId; readonly value: NodeId };

type Row = {
	readonly patterns: ReadonlyArray<NodeId>;
	readonly body: NodeId;
	readonly bindings: ReadonlyArray<Binding>;
};

type Head = {
	readonly tag: string;
	readonly key: string;
	readonly value: Payload;
	readonly arity: number;
	readonly subLabels: ReadonlyArray<string>;
};

// ── Pattern introspection ──

const patTag = (pid: NodeId, g: Graph): string => Nodes.get(pid)(g)?.tag ?? "";

const isWild = (pid: NodeId, g: Graph): boolean => {
	const tag = patTag(pid, g);
	return tag === Tags.PAT_WILDCARD || tag === Tags.PAT_BINDER;
};

const headKey = (pid: NodeId, g: Graph): string => {
	const node = Nodes.get(pid)(g);

	if (!node) {
		return "";
	}

	if (node.tag === Tags.PAT_VARIANT) {
		return String(node.payload.label);
	}

	if (node.tag === Tags.PAT_LIT) {
		return JSON.stringify(node.payload.value);
	}

	if (node.tag === Tags.PAT_STRUCT) {
		return "__struct__";
	}
	return "";
};

const patSubPatterns = (pid: NodeId, g: Graph): ReadonlyArray<{ label: string; node: NodeId }> => {
	const node = Nodes.get(pid)(g);

	if (!node) {
		return [];
	}

	if (node.tag === Tags.PAT_VARIANT) {
		const payload = Edges.one(pid, Labels.PAYLOAD)(g);
		return payload ? [{ label: "", node: payload.target }] : [];
	}

	if (node.tag === Tags.PAT_STRUCT) {
		return Edges.byLabel(
			pid,
			Labels.FIELD,
		)(g)
			.map(e => ({ label: String(e.payload.label), node: e.target }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	return [];
};

// ── Helpers ──

const freshWildcards = (count: number, g: Graph): [ReadonlyArray<NodeId>, Graph] =>
	Array.from({ length: count }).reduce<[NodeId[], Graph]>(
		([ids, gAcc]) => {
			const [id, gNext] = Nodes.add(Tags.PAT_WILDCARD, {}, PASS)(gAcc);
			return [[...ids, id], gNext];
		},
		[[], g],
	);

const inferKind = (rows: ReadonlyArray<Row>, col: number, g: Graph): string => {
	for (const row of rows) {
		const tag = patTag(row.patterns[col], g);

		if (tag === Tags.PAT_VARIANT) {
			return "tag";
		}

		if (tag === Tags.PAT_LIT) {
			return "lit";
		}

		if (tag === Tags.PAT_STRUCT) {
			return "struct";
		}
	}
	return "tag";
};

// Maranget: pick first column where the first row is not a wildcard
const pickColumn = (rows: ReadonlyArray<Row>, g: Graph): number => {
	for (let col = 0; col < rows[0].patterns.length; col++) {
		if (!isWild(rows[0].patterns[col], g)) {
			return col;
		}
	}
	return 0;
};

// ── Head extraction ──

const allStructLabels = (rows: ReadonlyArray<Row>, col: number, g: Graph): ReadonlyArray<string> => {
	const labels = new Set<string>();
	for (const row of rows) {
		if (patTag(row.patterns[col], g) === Tags.PAT_STRUCT) {
			for (const sp of patSubPatterns(row.patterns[col], g)) {
				labels.add(sp.label);
			}
		}
	}
	return [...labels].sort();
};

const headPayload = (pid: NodeId, g: Graph): Payload => {
	const node = Nodes.get(pid)(g);

	if (!node) {
		return {};
	}

	if (node.tag === Tags.PAT_VARIANT) {
		return { label: node.payload.label };
	}

	if (node.tag === Tags.PAT_LIT) {
		return { value: node.payload.value };
	}

	if (node.tag === Tags.PAT_STRUCT) {
		return {};
	}
	return {};
};

const distinctHeads = (rows: ReadonlyArray<Row>, col: number, g: Graph): ReadonlyArray<Head> => {
	const seen = new Map<string, Head>();

	for (const row of rows) {
		const pid = row.patterns[col];

		if (isWild(pid, g)) {
			continue;
		}

		const key = headKey(pid, g);

		if (seen.has(key)) {
			continue;
		}

		const tag = patTag(pid, g);
		const value = headPayload(pid, g);
		if (tag === Tags.PAT_STRUCT) {
			const labels = allStructLabels(rows, col, g);
			seen.set(key, { tag, key, value, arity: labels.length, subLabels: labels });
		} else {
			const subs = patSubPatterns(pid, g);
			seen.set(key, { tag, key, value, arity: subs.length, subLabels: subs.map(s => s.label) });
		}
	}

	return [...seen.values()];
};

// ── Matrix operations ──

const specializeRow = (head: Head, col: number, scrutinees: ReadonlyArray<NodeId>, row: Row, g: Graph): { row: Row; graph: Graph } | undefined => {
	const pid = row.patterns[col];

	if (isWild(pid, g)) {
		const newBindings = patTag(pid, g) === Tags.PAT_BINDER ? [...row.bindings, { binder: pid, value: scrutinees[col] }] : [...row.bindings];
		const [wilds, gW] = freshWildcards(head.arity, g);
		return {
			row: {
				patterns: [...row.patterns.slice(0, col), ...wilds, ...row.patterns.slice(col + 1)],
				body: row.body,
				bindings: newBindings,
			},
			graph: gW,
		};
	}

	if (headKey(pid, g) !== head.key) {
		return undefined;
	}

	if (head.tag === Tags.PAT_STRUCT) {
		const existing = new Map(patSubPatterns(pid, g).map(sp => [sp.label, sp.node]));
		const [normalized, gN] = head.subLabels.reduce<[NodeId[], Graph]>(
			([ids, gAcc], label) => {
				const node = existing.get(label);

				if (node !== undefined) {
					return [[...ids, node], gAcc];
				}
				const [wildId, gNext] = Nodes.add(Tags.PAT_WILDCARD, {}, PASS)(gAcc);
				return [[...ids, wildId], gNext];
			},
			[[], g],
		);
		return {
			row: {
				patterns: [...row.patterns.slice(0, col), ...normalized, ...row.patterns.slice(col + 1)],
				body: row.body,
				bindings: [...row.bindings],
			},
			graph: gN,
		};
	}

	const subs = patSubPatterns(pid, g);
	return {
		row: {
			patterns: [...row.patterns.slice(0, col), ...subs.map(s => s.node), ...row.patterns.slice(col + 1)],
			body: row.body,
			bindings: [...row.bindings],
		},
		graph: g,
	};
};

const specializeMatrix = (
	head: Head,
	col: number,
	scrutinees: ReadonlyArray<NodeId>,
	rows: ReadonlyArray<Row>,
	g: Graph,
): { rows: ReadonlyArray<Row>; scrutinees: ReadonlyArray<NodeId>; graph: Graph } => {
	let gAcc = g;
	const subScruts: NodeId[] = [];

	for (const label of head.subLabels) {
		const projLabel = label || head.key;
		const [projId, gNext] = Nodes.add(Tags.PROJ, { label: projLabel }, PASS)(gAcc);
		gAcc = Edges.add(projId, Labels.TARGET, scrutinees[col])(gNext);
		subScruts.push(projId);
	}

	const newScruts = [...scrutinees.slice(0, col), ...subScruts, ...scrutinees.slice(col + 1)];
	const specialized: Row[] = [];

	for (const row of rows) {
		const result = specializeRow(head, col, scrutinees, row, gAcc);
		if (result) {
			specialized.push(result.row);
			gAcc = result.graph;
		}
	}

	return { rows: specialized, scrutinees: newScruts, graph: gAcc };
};

const defaultMatrix = (
	col: number,
	scrutinees: ReadonlyArray<NodeId>,
	rows: ReadonlyArray<Row>,
	g: Graph,
): { rows: ReadonlyArray<Row>; scrutinees: ReadonlyArray<NodeId> } => {
	const newScruts = [...scrutinees.slice(0, col), ...scrutinees.slice(col + 1)];
	const defaults = rows
		.filter(r => isWild(r.patterns[col], g))
		.map(r => {
			const pid = r.patterns[col];
			const newBindings = patTag(pid, g) === Tags.PAT_BINDER ? [...r.bindings, { binder: pid, value: scrutinees[col] }] : [...r.bindings];
			return {
				patterns: [...r.patterns.slice(0, col), ...r.patterns.slice(col + 1)],
				body: r.body,
				bindings: newBindings,
			};
		});
	return { rows: defaults, scrutinees: newScruts };
};

// ── Leaf & Fail ──

const makeLeaf = (row: Row, g: Graph): [NodeId, Graph] => {
	const [leafId, g1] = Nodes.add(Tags.LEAF, {}, PASS)(g);
	let gAcc = Edges.add(leafId, Labels.BODY, row.body)(g1);

	for (const { binder } of row.bindings) {
		const name = String(Nodes.get(binder)(gAcc)?.payload.name ?? "");
		gAcc = Edges.add(leafId, Labels.BIND, binder, { name })(gAcc);
	}

	for (const pid of row.patterns) {
		if (patTag(pid, gAcc) === Tags.PAT_BINDER) {
			const name = String(Nodes.get(pid)(gAcc)?.payload.name ?? "");
			gAcc = Edges.add(leafId, Labels.BIND, pid, { name })(gAcc);
		}
	}

	return [leafId, gAcc];
};

// ── Core: Maranget decision tree compilation ──

const compile = (scrutinees: ReadonlyArray<NodeId>, rows: ReadonlyArray<Row>, g: Graph): [NodeId, Graph] => {
	if (rows.length === 0) {
		return Nodes.add(Tags.FAIL, {}, PASS)(g);
	}

	if (rows[0].patterns.every(pid => isWild(pid, g))) {
		return makeLeaf(rows[0], g);
	}

	const col = pickColumn(rows, g);
	const heads = distinctHeads(rows, col, g);
	const kind = inferKind(rows, col, g);
	const [switchId, g1] = Nodes.add(Tags.SWITCH, { kind }, PASS)(g);
	const g2 = Edges.add(switchId, Labels.INSPECT, scrutinees[col])(g1);

	let gAcc = g2;

	for (const head of heads) {
		const spec = specializeMatrix(head, col, scrutinees, rows, gAcc);
		const [child, gNext] = compile(spec.scrutinees, spec.rows, spec.graph);
		gAcc = Edges.add(switchId, Labels.BRANCH, child, head.value)(gNext);
	}

	const def = defaultMatrix(col, scrutinees, rows, gAcc);
	if (def.rows.length > 0) {
		const [defId, gDef] = compile(def.scrutinees, def.rows, gAcc);
		gAcc = Edges.add(switchId, Labels.DEFAULT, defId)(gDef);
	}

	return [switchId, gAcc];
};

// ── Top-level: process each match node ──

const compileMatch = (matchId: NodeId, g: Graph): Graph => {
	const scrutinee = Query.follow(matchId, Labels.SCRUTINEE)(g);

	if (scrutinee === undefined) {
		return g;
	}

	const alts = Edges.byLabel(
		matchId,
		Labels.ALT,
	)(g)
		.slice()
		.sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0));

	const rows: Row[] = alts.reduce<Row[]>((acc, alt) => {
		const patEdge = Edges.one(alt.target, Labels.PATTERN)(g);
		const bodyEdge = Edges.one(alt.target, Labels.BODY)(g);

		if (!patEdge || !bodyEdge) {
			return acc;
		}
		return [...acc, { patterns: [patEdge.target], body: bodyEdge.target, bindings: [] }];
	}, []);

	if (rows.length === 0) {
		return g;
	}

	const [rootSwitch, g1] = compile([scrutinee], rows, g);
	return Edges.add(matchId, Labels.DECISION_TREE, rootSwitch)(g1);
};

export const compilePatterns: Pass = (g: Graph): Graph => {
	const matches = [...Query.byTag(Tags.MATCH)(g)];
	return matches.reduce((acc, id) => compileMatch(id, acc), g);
};

export const descriptor: Descriptor = {
	name: "pattern",
	requires: {
		tags: new Set([Tags.MATCH, Tags.CASE, Tags.PAT_VARIANT, Tags.PAT_STRUCT, Tags.PAT_LIT, Tags.PAT_BINDER, Tags.PAT_WILDCARD]),
		labels: new Set([Labels.SCRUTINEE, Labels.ALT, Labels.PATTERN, Labels.PAYLOAD, Labels.FIELD]),
	},
	delta: {
		tags: { added: new Set([Tags.SWITCH, Tags.LEAF, Tags.FAIL]), removed: new Set() },
		labels: {
			added: new Set([Labels.DECISION_TREE, Labels.BRANCH, Labels.DEFAULT, Labels.INSPECT, Labels.BIND]),
			removed: new Set(),
		},
	},
	run: compilePatterns,
};
