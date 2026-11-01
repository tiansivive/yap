import { match } from "ts-pattern";
import { Nodes, Edges, type Graph, type NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";

export const passive = (id: NodeId, graph: Graph): boolean =>
	match(Nodes.get(id)(graph)?.tag)
		.with(Tags.LAMBDA, Tags.CLOSURE, Tags.LIT, Tags.VAR_FOREIGN, Tags.VAR_BOUND, Tags.VAR_REF, Tags.VAR_LABEL, Tags.VAR_NU_LABEL, () => true)
		.with(Tags.STRUCT, () => Edges.byLabel(id, Labels.FIELD)(graph).every(e => passive(e.target, graph)))
		.with(Tags.RESET, () => {
			const body = Edges.one(id, Labels.ENTRY)(graph)?.target;
			return body !== undefined && passive(body, graph);
		})
		.with(Tags.MODAL, () => {
			const target = Edges.one(id, Labels.TERM)(graph)?.target;
			return target !== undefined && passive(target, graph);
		})
		.otherwise(() => false);

export const demand = (graph: Graph): ReadonlySet<NodeId> => {
	const seen = new Set<NodeId>();
	const visit = (id: NodeId): void => {
		if (seen.has(id)) {
			return;
		}
		seen.add(id);
		match(Nodes.get(id)(graph)?.tag)
			.with(Tags.CONTINUATION, () => {
				const body = Edges.one(id, Labels.BODY)(graph)?.target;
				if (body !== undefined) {
					visit(body);
				}
			})
			.with(Tags.RESET, () => {
				const target = Edges.one(id, Labels.ENTRY)(graph)?.target ?? Edges.one(id, Labels.BODY)(graph)?.target;
				if (target !== undefined) {
					visit(target);
				}
			})
			.with(Tags.BLOCK, () => {
				Edges.byLabel(
					id,
					Labels.STMT,
				)(graph).forEach(e => {
					const value = Edges.one(e.target, Labels.VALUE)(graph)?.target;
					if (value !== undefined && !passive(value, graph)) {
						visit(e.target);
					}
				});
				const result = Edges.one(id, Labels.RETURN)(graph)?.target;
				if (result !== undefined) {
					visit(result);
				}
			})
			.otherwise(() => {
				Edges.outgoing(id)(graph)
					.filter(
						e =>
							isStructural(e.label) ||
							new Set<string>([Labels.REFERS_TO, Labels.INVOKES, Labels.DECISION_TREE, Labels.INSPECT, Labels.BRANCH, Labels.DEFAULT, Labels.BIND]).has(
								e.label,
							),
					)
					.forEach(e => visit(e.target));
			});
	};
	visit(graph.root);
	return seen;
};
