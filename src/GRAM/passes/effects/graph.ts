import { Edges, Nodes, type Graph, type NodeId, type Payload } from "../../graph";
import { Labels, Tags } from "../../vocabulary";

const LINKS = new Set<string>([
	Labels.BODY,
	Labels.VALUE,
	Labels.FUNC,
	Labels.ARG,
	Labels.TARGET,
	Labels.TERM,
	Labels.IDENTITY,
	Labels.HANDLER,
	Labels.PAYLOAD,
	Labels.FIELD,
	Labels.RETURN,
	Labels.STMT,
	Labels.SCRUTINEE,
	Labels.DECISION_TREE,
	Labels.INSPECT,
	Labels.BRANCH,
	Labels.DEFAULT,
	Labels.BIND,
]);

/** A graph builder for substitution and residual syntax. Binder references retain graph identity. */
export class Syntax {
	constructor(public graph: Graph) {}

	node(id: NodeId) {
		return Nodes.get(id)(this.graph)!;
	}
	edges(id: NodeId, label: string) {
		return [...Edges.byLabel(id, label)(this.graph)].sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0));
	}
	get(id: NodeId, label: string): NodeId {
		const target = this.optional(id, label);
		if (target === undefined) {
			throw new Error(`Effects enrichment: ${id} requires ${label}`);
		}
		return target;
	}
	optional(id: NodeId, label: string) {
		return Edges.one(id, label)(this.graph)?.target;
	}
	link(id: NodeId, label: string, target: NodeId, payload: Payload = {}) {
		this.graph = Edges.add(id, label, target, payload)(this.graph);
	}
	set(id: NodeId, label: string, target: NodeId) {
		this.graph = this.edges(id, label).reduce((g, e) => Edges.remove(e)(g), this.graph);
		this.link(id, label, target);
	}
	add(tag: string, payload: Payload = {}, links: readonly (readonly [string, NodeId, Payload?])[] = []): NodeId {
		const [id, graph] = Nodes.add(tag, payload, { created_by: "effects" })(this.graph);
		this.graph = graph;
		links.forEach(([label, target, data]) => this.link(id, label, target, data));
		return id;
	}
	ref(binder: NodeId) {
		return this.add(Tags.VAR_BOUND, {}, [[Labels.REFERS_TO, binder]]);
	}
	origin(id: NodeId): NodeId {
		const origin = this.optional(id, Labels.DERIVED_FROM);
		return origin === undefined ? id : this.origin(origin);
	}

	copy(root: NodeId, substitutions: ReadonlyMap<NodeId, NodeId> = new Map()): NodeId {
		const copies = new Map<NodeId, NodeId>();
		const visit = (id: NodeId): NodeId => {
			const replacement = substitutions.get(id);
			if (replacement !== undefined) {
				return replacement;
			}
			const existing = copies.get(id);
			if (existing !== undefined) {
				return existing;
			}
			const node = this.node(id);
			if (node.tag === Tags.CONTINUATION || node.tag === Tags.BUBBLE) {
				return id;
			}
			const target = this.optional(id, Labels.REFERS_TO);
			const bound = target === undefined ? undefined : substitutions.get(target);
			if (bound !== undefined) {
				return bound;
			}
			const fresh = this.add(node.tag, node.payload);
			copies.set(id, fresh);
			this.link(fresh, Labels.DERIVED_FROM, this.origin(id));
			Edges.outgoing(id)(this.graph)
				.filter(e => LINKS.has(e.label))
				.forEach(e => this.link(fresh, e.label, visit(e.target), e.payload));
			this.edges(id, Labels.BIND).forEach(e => {
				if (typeof e.payload.binder === "number") {
					visit(e.payload.binder);
				}
			});
			const invokes = this.optional(id, Labels.INVOKES);
			if (invokes !== undefined) {
				this.link(fresh, Labels.INVOKES, invokes);
			}
			return fresh;
		};
		const result = visit(root);
		copies.forEach((fresh, old) => {
			const target = this.optional(old, Labels.REFERS_TO);
			if (target !== undefined) {
				this.link(fresh, Labels.REFERS_TO, copies.get(target) ?? target);
			}
			this.edges(fresh, Labels.BIND).forEach(e => {
				const binder = e.payload.binder as number | undefined;
				if (binder !== undefined && copies.has(binder)) {
					this.graph = Edges.remove(e)(this.graph);
					this.link(fresh, Labels.BIND, e.target, { ...e.payload, binder: copies.get(binder) });
				}
			});
		});
		return result;
	}

	resolve(id: NodeId, seen: ReadonlySet<NodeId> = new Set()): NodeId {
		if (seen.has(id)) {
			return id;
		}
		const node = this.node(id);
		const target = [Tags.VAR_BOUND, Tags.VAR_REF, Tags.VAR_LABEL, Tags.VAR_NU_LABEL].includes(node.tag as never)
			? this.optional(id, Labels.REFERS_TO)
			: [Tags.LET, Tags.STMT_LET].includes(node.tag as never)
				? this.optional(id, Labels.VALUE)
				: undefined;
		return target === undefined ? id : this.resolve(target, new Set([...seen, id]));
	}
}
