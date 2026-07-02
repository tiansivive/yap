import { match } from "ts-pattern";

import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId, Payload } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";

const PASS = { created_by: "pattern" } as const;

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

type Acc<T> = readonly [T, Graph];

export const compilePatterns: Pass = (g: Graph): Graph => [...Query.byTag(Tags.MATCH)(g)].reduce((acc, id) => compileMatch(id, acc), g);

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

const compileMatch = (matchId: NodeId, g: Graph): Graph => {
	const scrutinee = Query.follow(matchId, Labels.SCRUTINEE)(g);

	if (scrutinee === undefined) {
		return g;
	}

	const rows = Edges.byLabel(
		matchId,
		Labels.ALT,
	)(g)
		.slice()
		.sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0))
		.flatMap(alt => {
			const patEdge = Edges.one(alt.target, Labels.PATTERN)(g);
			const bodyEdge = Edges.one(alt.target, Labels.BODY)(g);
			return patEdge !== undefined && bodyEdge !== undefined ? [{ patterns: [patEdge.target], body: bodyEdge.target, bindings: [] as Binding[] }] : [];
		});

	if (rows.length === 0) {
		return g;
	}

	const [rootSwitch, g1] = compile([scrutinee], rows, g);
	return Edges.add(matchId, Labels.DECISION_TREE, rootSwitch)(g1);
};

const compile = (scrutinees: ReadonlyArray<NodeId>, rows: ReadonlyArray<Row>, g: Graph): Acc<NodeId> => {
	if (rows.length === 0) {
		return Nodes.add(Tags.FAIL, {}, PASS)(g);
	}

	if (rows[0].patterns.every(pid => Pat.wild(pid, g))) {
		return leaf(rows[0], scrutinees, g);
	}

	const col = column(rows, g);
	const heads = Heads.distinct(rows, col, g);
	const kind = Heads.kind(rows, col, g);
	const [switchId, g1] = Nodes.add(Tags.SWITCH, { kind }, PASS)(g);
	const g2 = Edges.add(switchId, Labels.INSPECT, scrutinees[col])(g1);

	const g3 = heads.reduce((acc, head) => {
		const spec = Matrix.specialize(head, col, scrutinees, rows, acc);
		const [child, gNext] = compile(spec.scrutinees, spec.rows, spec.graph);
		return Edges.add(switchId, Labels.BRANCH, child, head.value)(gNext);
	}, g2);

	const def = Matrix.defaults(col, scrutinees, rows, g3);

	if (def.rows.length === 0) {
		return [switchId, g3];
	}
	const [defId, g4] = compile(def.scrutinees, def.rows, g3);
	return [switchId, Edges.add(switchId, Labels.DEFAULT, defId)(g4)];
};

const column = (rows: ReadonlyArray<Row>, g: Graph): number => {
	const idx = rows[0].patterns.findIndex(pid => !Pat.wild(pid, g));
	return idx >= 0 ? idx : 0;
};

const leaf = (row: Row, scrutinees: ReadonlyArray<NodeId>, g: Graph): Acc<NodeId> => {
	const [leafId, g1] = Nodes.add(Tags.LEAF, {}, PASS)(g);
	const g2 = Edges.add(leafId, Labels.BODY, row.body)(g1);
	const g3 = row.bindings.reduce((acc, { binder, value }) => {
		const name = String(Nodes.get(binder)(acc)?.payload.name ?? "");
		return Edges.add(leafId, Labels.BIND, value, { name, binder })(acc);
	}, g2);
	const g4 = row.patterns.reduce((acc, pid, i) => {
		if (Pat.tag(pid, acc) !== Tags.PAT_BINDER) {
			return acc;
		}
		const name = String(Nodes.get(pid)(acc)?.payload.name ?? "");
		const target = scrutinees[i] ?? pid;
		return Edges.add(leafId, Labels.BIND, target, { name, binder: pid })(acc);
	}, g3);
	return [leafId, g4];
};

const bindings = (pid: NodeId, scrutinee: NodeId, row: Row, g: Graph): ReadonlyArray<Binding> =>
	Pat.tag(pid, g) === Tags.PAT_BINDER ? [...row.bindings, { binder: pid, value: scrutinee }] : [...row.bindings];

const Matrix = {
	specialize(
		head: Head,
		col: number,
		scrutinees: ReadonlyArray<NodeId>,
		rows: ReadonlyArray<Row>,
		g: Graph,
	): { rows: ReadonlyArray<Row>; scrutinees: ReadonlyArray<NodeId>; graph: Graph } {
		const [subScruts, g1] = head.subLabels.reduce<Acc<NodeId[]>>(
			([ids, gAcc], label) => {
				const projLabel = label || head.key;
				const [projId, gNext] = Nodes.add(Tags.PROJ, { label: projLabel }, PASS)(gAcc);
				const gLinked = Edges.add(projId, Labels.TARGET, scrutinees[col])(gNext);
				return [[...ids, projId], gLinked];
			},
			[[], g],
		);

		const newScruts = splice(scrutinees, col, subScruts);

		const [specialized, g2] = rows.reduce<Acc<Row[]>>(
			([acc, gAcc], row) => {
				const result = Row.specialize(head, col, scrutinees, row, gAcc);
				return result !== undefined ? [[...acc, result.row], result.graph] : [acc, gAcc];
			},
			[[], g1],
		);

		return { rows: specialized, scrutinees: newScruts, graph: g2 };
	},

	defaults(
		col: number,
		scrutinees: ReadonlyArray<NodeId>,
		rows: ReadonlyArray<Row>,
		g: Graph,
	): { rows: ReadonlyArray<Row>; scrutinees: ReadonlyArray<NodeId> } {
		return {
			scrutinees: splice(scrutinees, col, []),
			rows: rows
				.filter(r => Pat.wild(r.patterns[col], g))
				.map(r => ({
					patterns: splice(r.patterns, col, []),
					body: r.body,
					bindings: bindings(r.patterns[col], scrutinees[col], r, g),
				})),
		};
	},
};

const Row = {
	specialize(head: Head, col: number, scrutinees: ReadonlyArray<NodeId>, row: Row, g: Graph): { row: Row; graph: Graph } | undefined {
		const pid = row.patterns[col];

		if (Pat.wild(pid, g)) {
			const [wilds, gW] = Wild.fresh(head.arity, g);
			return {
				row: { patterns: splice(row.patterns, col, wilds), body: row.body, bindings: bindings(pid, scrutinees[col], row, g) },
				graph: gW,
			};
		}

		if (Pat.key(pid, g) !== head.key) {
			return undefined;
		}

		return match(head.tag)
			.with(Tags.PAT_STRUCT, () => {
				const existing = new Map(Pat.subs(pid, g).map(sp => [sp.label, sp.node]));
				const [normalized, gN] = head.subLabels.reduce<Acc<NodeId[]>>(
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
					row: { patterns: splice(row.patterns, col, normalized), body: row.body, bindings: [...row.bindings] },
					graph: gN,
				};
			})
			.otherwise(() => ({
				row: {
					patterns: splice(
						row.patterns,
						col,
						Pat.subs(pid, g).map(s => s.node),
					),
					body: row.body,
					bindings: [...row.bindings],
				},
				graph: g,
			}));
	},
};

const Heads = {
	distinct(rows: ReadonlyArray<Row>, col: number, g: Graph): ReadonlyArray<Head> {
		return rows.reduce<ReadonlyArray<Head>>((acc, row) => {
			const pid = row.patterns[col];

			if (Pat.wild(pid, g)) {
				return acc;
			}
			const key = Pat.key(pid, g);

			if (acc.some(h => h.key === key)) {
				return acc;
			}
			const tag = Pat.tag(pid, g);
			const value = Pat.payload(pid, g);
			return match(tag)
				.with(Tags.PAT_STRUCT, () => {
					const labels = Heads.labels(rows, col, g);
					return [...acc, { tag, key, value, arity: labels.length, subLabels: labels }];
				})
				.otherwise(() => {
					const subs = Pat.subs(pid, g);
					return [...acc, { tag, key, value, arity: subs.length, subLabels: subs.map(s => s.label) }];
				});
		}, []);
	},

	kind(rows: ReadonlyArray<Row>, col: number, g: Graph): string {
		const found = rows.find(row =>
			match(Pat.tag(row.patterns[col], g))
				.with(Tags.PAT_VARIANT, () => true)
				.with(Tags.PAT_LIT, () => true)
				.with(Tags.PAT_STRUCT, () => true)
				.otherwise(() => false),
		);

		if (found === undefined) {
			return "tag";
		}
		return match(Pat.tag(found.patterns[col], g))
			.with(Tags.PAT_VARIANT, () => "tag")
			.with(Tags.PAT_LIT, () => "lit")
			.with(Tags.PAT_STRUCT, () => "struct")
			.otherwise(() => "tag");
	},

	labels(rows: ReadonlyArray<Row>, col: number, g: Graph): ReadonlyArray<string> {
		const labels = rows.filter(row => Pat.tag(row.patterns[col], g) === Tags.PAT_STRUCT).flatMap(row => Pat.subs(row.patterns[col], g).map(sp => sp.label));
		return [...new Set(labels)].sort();
	},
};

const Pat = {
	tag: (pid: NodeId, g: Graph): string => Nodes.get(pid)(g)?.tag ?? "",

	wild: (pid: NodeId, g: Graph): boolean =>
		match(Pat.tag(pid, g))
			.with(Tags.PAT_WILDCARD, () => true)
			.with(Tags.PAT_BINDER, () => true)
			.otherwise(() => false),

	key: (pid: NodeId, g: Graph): string => {
		const node = Nodes.get(pid)(g);

		if (!node) {
			return "";
		}
		return match(node.tag)
			.with(Tags.PAT_VARIANT, () => String(node.payload.label))
			.with(Tags.PAT_LIT, () => JSON.stringify(node.payload.value))
			.with(Tags.PAT_STRUCT, () => "__struct__")
			.otherwise(() => "");
	},

	payload: (pid: NodeId, g: Graph): Payload => {
		const node = Nodes.get(pid)(g);

		if (!node) {
			return {};
		}
		return match(node.tag)
			.with(Tags.PAT_VARIANT, () => ({ label: node.payload.label }))
			.with(Tags.PAT_LIT, () => ({ value: node.payload.value }))
			.otherwise(() => ({}));
	},

	subs: (pid: NodeId, g: Graph): ReadonlyArray<{ label: string; node: NodeId }> => {
		const node = Nodes.get(pid)(g);

		if (!node) {
			return [];
		}
		return match(node.tag)
			.with(Tags.PAT_VARIANT, () => {
				const edge = Edges.one(pid, Labels.PAYLOAD)(g);
				if (!edge) {
					return [];
				}
				return [{ label: "payload", node: edge.target }];
			})
			.with(Tags.PAT_STRUCT, () =>
				Edges.byLabel(
					pid,
					Labels.FIELD,
				)(g)
					.map(e => ({ label: String(e.payload.label), node: e.target }))
					.sort((a, b) => a.label.localeCompare(b.label)),
			)
			.otherwise(() => []);
	},
};

const splice = <T>(arr: ReadonlyArray<T>, col: number, replacement: ReadonlyArray<T>): ReadonlyArray<T> => [
	...arr.slice(0, col),
	...replacement,
	...arr.slice(col + 1),
];

const Wild = {
	fresh: (count: number, g: Graph): Acc<ReadonlyArray<NodeId>> =>
		Array.from({ length: count }).reduce<Acc<NodeId[]>>(
			([ids, gAcc]) => {
				const [id, gNext] = Nodes.add(Tags.PAT_WILDCARD, {}, PASS)(gAcc);
				return [[...ids, id], gNext];
			},
			[[], g],
		),
};
