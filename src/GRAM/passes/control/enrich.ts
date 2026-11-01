import { match } from "ts-pattern";
import { Edges, Nodes, type Graph, type NodeId, type Payload } from "../../graph";
import { Labels, Tags, isStructural } from "../../vocabulary";
import { Match } from "../../grs/match";
import * as Rewrite from "../../grs/rewrite";
import type { Rule, Constructor, RuleEdge } from "../../grs/rule";
import { analyze, uses, type Term } from "./analysis";

const anchor: Rule = {
	lhs: { nodes: [{ bind: "$reset", tag: Tags.RESET }], edges: [] },
	rhs: { nodes: [{ bind: "$reset" }], edges: [] },
	where: (bindings, graph) => Edges.one(resetOf(bindings), Labels.ENTRY)(graph) === undefined,
};

export const enrich = (graph: Graph): Graph =>
	!graph.byTag.get(Tags.CAPTURE)?.size && !graph.byTag.get(Tags.SHIFT)?.size
		? graph
		: Match.all(anchor, graph)
				.filter(bindings => {
					const outside = (id: NodeId, seen: ReadonlySet<NodeId> = new Set()): boolean => {
						if (seen.has(id)) {
							return false;
						}
						return Edges.to(id)(graph)
							.filter(e => isStructural(e.label))
							.every(e => {
								const tag = Nodes.get(e.source)(graph)?.tag;
								return tag === Tags.LAMBDA || (tag !== Tags.RESET && outside(e.source, new Set([...seen, id])));
							});
					};
					return outside(resetOf(bindings));
				})
				.reduce((g, bindings) => {
					const reset = resetOf(bindings);
					const plan = analyze(reset, graph);
					if (plan.continuations.length === 0) {
						return g;
					}
					const rule = describe(reset, plan, graph);
					const next = Rewrite.apply(rule.rule, g, rule.bindings);
					if (next === undefined) {
						throw new Error(`Control enrichment: additive rule for reset ${reset} failed`);
					}
					return next;
				}, graph);

const describe = (reset: NodeId, plan: ReturnType<typeof analyze>, graph: Graph): { rule: Rule; bindings: ReadonlyMap<string, NodeId> } => {
	const originals = new Map<NodeId, string>([[reset, "$reset"]]);
	const constructors = new Map<string, Constructor>();
	const links = new Set<RuleEdge>();
	const terms = new Map<Term, string>();
	const variables = new Map<symbol, { binder: string; ref?: string; hole?: boolean }>();
	const node = (id: NodeId) => {
		const value = Nodes.get(id)(graph);
		if (value === undefined) {
			throw new Error(`Control enrichment: missing source node ${id}`);
		}
		return value;
	};
	const original = (id: NodeId): string => {
		const existing = originals.get(id);
		if (existing) {
			return existing;
		}
		const bind = `$source${id}`;
		originals.set(id, bind);
		return bind;
	};
	const link = (source: string, label: string, target: string, payload?: Payload): void => {
		links.add({ source, label, target, payload });
	};
	const add = (tag: string, payload: Payload = {}): string => {
		const bind = `$derived${constructors.size}`;
		constructors.set(bind, { bind, tag, payload, provenance: { created_by: "control" } });
		return bind;
	};
	const derived = (term: { id: NodeId }, tag = node(term.id).tag): string => {
		const bind = add(tag, node(term.id).payload);
		link(bind, Labels.DERIVED_FROM, original(term.id));
		return bind;
	};
	const variable = (key: symbol): string => {
		const binding = variables.get(key);
		if (!binding) {
			throw new Error("Control enrichment: residual variable requires its binding");
		}
		if (binding.hole) {
			return binding.binder;
		}
		if (binding.ref) {
			return binding.ref;
		}
		const ref = add(Tags.VAR_BOUND);
		link(ref, Labels.REFERS_TO, binding.binder);
		variables.set(key, { ...binding, ref });
		return ref;
	};

	const emit = (term: Term): string => {
		const existing = terms.get(term);
		if (existing) {
			return existing;
		}
		const result = match(term)
			.with({ kind: "source" }, t => original(t.id))
			.with({ kind: "variable" }, t => variable(t.key))
			.with({ kind: "closure" }, t => original(t.id))
			.with({ kind: "binding" }, t => {
				if (t.value.kind === "operation" && Nodes.get(t.value.id)(graph)?.tag === Tags.STRUCT && !uses(t.body, t.key)) {
					return emit(t.body);
				}
				const bind = add(Tags.LET);
				variables.set(t.key, { binder: bind });
				link(bind, Labels.VALUE, emit(t.value));
				link(bind, Labels.BODY, emit(t.body));
				return bind;
			})
			.with({ kind: "operation" }, t => {
				const operands = t.edges.map(e => ({ ...e, target: emit(e.value) }));
				const unchanged =
					(t.tag === undefined || t.tag === node(t.id).tag) &&
					operands.every(e =>
						Edges.byLabel(t.id, e.label)(graph).some(old => original(old.target) === e.target && JSON.stringify(old.payload) === JSON.stringify(e.payload)),
					);
				if (unchanged) {
					return original(t.id);
				}
				const bind = derived(t, t.tag);
				operands.forEach(e => link(bind, e.label, e.target, e.payload));
				return bind;
			})
			.with({ kind: "capture" }, t => {
				const bind = derived(t, Tags.CAPTURE);
				link(bind, Labels.IDENTITY, emit(t.identity));
				link(bind, Labels.PAYLOAD, emit(t.payload));
				return bind;
			})
			.with({ kind: "continuation" }, t => {
				const bind = add(Tags.CONTINUATION);
				terms.set(t, bind);
				const declaration = Edges.to(t.id)(graph).find(e => e.label === Labels.VALUE && Nodes.get(e.source)(graph)?.tag === Tags.STMT_LET);
				const binder = declaration === undefined ? `$capture_${t.id}` : node(declaration.source).payload.variable;
				const hole = add(Tags.BUBBLE, { binder });
				variables.set(t.hole.key, { binder: hole, hole: true });
				link(bind, Labels.CAPTURED_AT, original(t.id));
				link(bind, Labels.DELIMITER, original(t.reset));
				link(bind, Labels.HOLE, hole);
				link(bind, Labels.BODY, emit(t.body));
				if (t.handler && "id" in t.handler) {
					link(bind, Labels.HANDLER, original(t.handler.id));
				}
				const env = add(Tags.ENV);
				link(bind, Labels.ENV, env);
				free(t.body, t.hole.key, graph).forEach((key, index) => {
					const target = typeof key === "number" ? original(key) : variables.get(key)?.binder;
					if (!target) {
						throw new Error("Control enrichment: saved binding requires its definition");
					}
					link(env, Labels.CAPTURE, target, { index });
				});
				return bind;
			})
			.with({ kind: "resumption" }, t => {
				const bind = derived(t, Tags.RESUMPTION);
				link(bind, Labels.INVOKES, emit(t.continuation));
				link(bind, Labels.ARG, emit(t.arg));
				return bind;
			})
			.with({ kind: "decision" }, t => {
				const bind = derived(t);
				link(bind, Labels.INSPECT, emit(t.inspect));
				t.branches.forEach(b => link(bind, Labels.BRANCH, emit(b.value), b.payload));
				if (t.fallback) {
					link(bind, Labels.DEFAULT, emit(t.fallback));
				}
				return bind;
			})
			.with({ kind: "leaf" }, t => {
				const bind = derived(t);
				t.bindings.forEach(b => link(bind, Labels.BIND, emit(b.value), b.payload));
				link(bind, Labels.BODY, emit(t.body));
				return bind;
			})
			.exhaustive();
		terms.set(term, result);
		return result;
	};

	link("$reset", Labels.ENTRY, emit(plan.entry));
	plan.continuations.forEach(emit);
	const retained = [...originals.values()].map(bind => ({ bind }));
	return {
		rule: { lhs: { nodes: retained, edges: [] }, rhs: { nodes: [...retained, ...constructors.values()], edges: [...links] } },
		bindings: new Map([...originals].map(([id, bind]) => [bind, id])),
	};
};

const resetOf = (bindings: ReadonlyMap<string, NodeId>): NodeId => {
	const reset = bindings.get("$reset");
	if (reset === undefined) {
		throw new Error("Control enrichment: reset pattern requires its anchor");
	}
	return reset;
};

const free = (term: Term, hole: symbol, graph: Graph): readonly (NodeId | symbol)[] => {
	const locals = new Set<NodeId | symbol>([hole]);
	const refs = new Set<NodeId | symbol>();
	const visit = (t: Term): void => {
		match(t)
			.with({ kind: "variable" }, v => {
				refs.add(v.key);
			})
			.with({ kind: "source" }, v => {
				const target = Edges.one(v.id, Labels.REFERS_TO)(graph)?.target;
				if (target !== undefined) {
					refs.add(target);
				}
			})
			.with({ kind: "binding" }, v => {
				locals.add(v.key);
				visit(v.value);
				visit(v.body);
			})
			.with({ kind: "operation" }, v => {
				v.edges.forEach(e => visit(e.value));
			})
			.with({ kind: "resumption" }, v => {
				visit(v.arg);
				locals.add(v.continuation.hole.key);
				visit(v.continuation.body);
			})
			.with({ kind: "decision" }, v => {
				visit(v.inspect);
				v.branches.forEach(b => visit(b.value));
				if (v.fallback) {
					visit(v.fallback);
				}
			})
			.with({ kind: "leaf" }, v => {
				v.bindings.forEach(b => {
					locals.add(Number(b.payload.binder));
					visit(b.value);
				});
				visit(v.body);
			})
			.otherwise(() => undefined);
	};
	visit(term);
	return [...refs].filter(ref => !locals.has(ref));
};
