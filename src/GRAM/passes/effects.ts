import { match } from "ts-pattern";
import { entry, Nodes, type Graph, type NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Descriptor } from "../pipeline/descriptor";
import { Syntax } from "./effects/graph";

export const effects = (graph: Graph): Graph => {
	const root = entry(graph);
	if (root === undefined || !graph.byTag.get(Tags.CAPTURE)?.size) {
		return graph;
	}
	const rewrite = new Residual(graph);
	const body = rewrite.normalize(rewrite.copy(root));
	rewrite.link(graph.root, Labels.MATERIALIZES, rewrite.prune(body));
	rewrite.environments();
	return rewrite.graph;
};

class Residual extends Syntax {
	private children(id: NodeId): NodeId[] {
		return match(this.node(id).tag)
			.with(Tags.LET, () => [this.get(id, Labels.VALUE), this.get(id, Labels.BODY)])
			.with(Tags.LEAF, () => [this.get(id, Labels.BODY), ...this.edges(id, Labels.BIND).map(e => e.target)])
			.with(Tags.SWITCH, () => [this.get(id, Labels.INSPECT), ...[...this.edges(id, Labels.BRANCH), ...this.edges(id, Labels.DEFAULT)].map(e => e.target)])
			.with(Tags.RESUMPTION, () => [this.get(id, Labels.ARG), this.get(this.get(id, Labels.INVOKES), Labels.BODY)])
			.with(Tags.PRIMOP, Tags.EXTERNAL, () => this.edges(id, Labels.ARG).map(e => e.target))
			.with(Tags.STRUCT, () => this.edges(id, Labels.FIELD).map(e => e.target))
			.with(Tags.APP, () => [this.get(id, Labels.FUNC), this.get(id, Labels.ARG)])
			.with(Tags.PROJ, () => [this.get(id, Labels.TARGET)])
			.with(Tags.INJ, () => [this.get(id, Labels.TARGET), this.get(id, Labels.VALUE)])
			.with(Tags.CAPTURE, () => [this.get(id, Labels.IDENTITY), this.get(id, Labels.PAYLOAD)])
			.otherwise(() => []);
	}

	private nodes(root: NodeId): NodeId[] {
		const seen = new Set<NodeId>();
		const visit = (id: NodeId): void => {
			if (seen.has(id)) {
				return;
			}
			seen.add(id);
			this.children(id).forEach(visit);
		};
		visit(root);
		return [...seen];
	}

	prune(id: NodeId): NodeId {
		return match(this.node(id).tag)
			.with(Tags.LET, () => {
				const body = this.prune(this.get(id, Labels.BODY));
				this.set(id, Labels.BODY, body);
				const used = this.nodes(body).some(n => this.optional(n, Labels.REFERS_TO) === id);
				const value = this.get(id, Labels.VALUE);
				return !used && [Tags.LAMBDA, Tags.STRUCT, Tags.LIT, Tags.VAR_BOUND].includes(this.node(value).tag as never) ? body : id;
			})
			.with(Tags.SWITCH, Tags.LEAF, () => this.tree(id, body => this.prune(body)))
			.otherwise(() => id);
	}

	environments(): void {
		[...(this.graph.byTag.get(Tags.CONTINUATION) ?? [])]
			.filter(id => this.optional(id, Labels.BODY) !== undefined)
			.forEach(id => {
				const body = this.prune(this.get(id, Labels.BODY));
				this.set(id, Labels.BODY, body);
				const nodes = this.nodes(body);
				const local = new Set([
					this.get(id, Labels.HOLE),
					...nodes.filter(n => this.node(n).tag === Tags.RESUMPTION).map(n => this.get(this.get(n, Labels.INVOKES), Labels.HOLE)),
					...nodes.filter(n => this.node(n).tag === Tags.LET),
					...nodes.flatMap(n => this.edges(n, Labels.BIND).map(e => Number(e.payload.binder))),
				]);
				const free = [
					...new Set(
						nodes.flatMap(n => {
							const target = this.optional(n, Labels.REFERS_TO);
							return this.node(n).tag === Tags.BUBBLE ? [n] : target === undefined ? [] : [target];
						}),
					),
				].filter(n => !local.has(n));
				const env = this.add(Tags.ENV);
				free.forEach((target, index) => this.link(env, Labels.CAPTURE, target, { index }));
				this.link(id, Labels.ENV, env);
			});
	}
	normalize(id: NodeId, calls: ReadonlySet<NodeId> = new Set()): NodeId {
		const node = this.node(id);
		const norm = (id: NodeId) => this.normalize(id, calls);
		return match(node.tag)
			.with(Tags.MODAL, () => norm(this.get(id, Labels.TERM)))
			.with(Tags.CLOSURE, Tags.NU, () => norm(this.get(id, Labels.BODY)))
			.with(Tags.VAR_REF, Tags.VAR_LABEL, Tags.VAR_NU_LABEL, () => norm(this.resolve(id)))
			.with(Tags.BLOCK, () => this.block(id, calls))
			.with(Tags.LET, () =>
				this.sequence(norm(this.get(id, Labels.VALUE)), value => {
					this.set(id, Labels.VALUE, value);
					this.set(id, Labels.BODY, norm(this.get(id, Labels.BODY)));
					return id;
				}),
			)
			.with(Tags.APP, () =>
				this.sequence(norm(this.get(id, Labels.FUNC)), fn => this.sequence(norm(this.get(id, Labels.ARG)), arg => this.apply(fn, arg, calls))),
			)
			.with(Tags.PROJ, () =>
				this.sequence(norm(this.get(id, Labels.TARGET)), target => {
					const record = this.resolve(target);
					const field = this.edges(record, Labels.FIELD).find(e => e.payload.label === node.payload.label);
					return field === undefined ? this.add(Tags.PROJ, node.payload, [[Labels.TARGET, target]]) : field.target;
				}),
			)
			.with(Tags.PRIMOP, Tags.EXTERNAL, Tags.STRUCT, Tags.INJ, () => {
				const label = node.tag === Tags.STRUCT ? Labels.FIELD : Labels.ARG;
				const edges = node.tag === Tags.INJ ? [this.edges(id, Labels.VALUE)[0], this.edges(id, Labels.TARGET)[0]] : this.edges(id, label);
				return this.operands(
					edges.map(e => e.target),
					norm,
					values =>
						this.add(
							node.tag,
							node.payload,
							edges.map((e, i) => [e.label, values[i], e.payload]),
						),
				);
			})
			.with(Tags.RESET, () => {
				const identity = this.optional(id, Labels.IDENTITY);
				const handler = this.optional(id, Labels.HANDLER);
				const operands = [identity, handler].filter((x): x is number => x !== undefined);
				return this.operands(operands, norm, values => {
					if (identity !== undefined) {
						this.set(id, Labels.IDENTITY, values[0]);
					}
					if (handler !== undefined) {
						this.set(id, Labels.HANDLER, values[identity === undefined ? 0 : 1]);
					}
					const body = norm(this.get(id, Labels.BODY));
					this.set(id, Labels.BODY, body);
					const result = this.delimit(body, id);
					this.link(id, Labels.MATERIALIZES, result);
					return result;
				});
			})
			.with(Tags.CAPTURE, () =>
				this.operands([this.get(id, Labels.IDENTITY), this.get(id, Labels.PAYLOAD)], norm, ([identity, payload]) => {
					this.set(id, Labels.IDENTITY, identity);
					this.set(id, Labels.PAYLOAD, payload);
					return id;
				}),
			)
			.with(Tags.MATCH, () =>
				this.sequence(norm(this.get(id, Labels.SCRUTINEE)), scrutinee => {
					const tree = this.get(id, Labels.DECISION_TREE);
					const copied = this.copy(tree, new Map([[this.get(id, Labels.SCRUTINEE), scrutinee]]));
					return this.tree(copied, norm);
				}),
			)
			.with(Tags.SWITCH, Tags.LEAF, () => this.tree(id, norm))
			.with(Tags.PI, Tags.SIGMA, Tags.SIGMA_V2, Tags.MU, Tags.VAR_META, Tags.ROW_EMPTY, () => this.add(Tags.LIT, { value: { type: "Atom", value: "Unit" } }))
			.otherwise(() => id);
	}

	private block(id: NodeId, calls: ReadonlySet<NodeId>): NodeId {
		const statements = this.edges(id, Labels.STMT);
		const build = (index: number): NodeId => {
			if (index === statements.length) {
				return this.normalize(this.get(id, Labels.RETURN), calls);
			}
			const binder = statements[index].target;
			return this.sequence(this.normalize(this.get(binder, Labels.VALUE), calls), value => {
				this.set(binder, Labels.VALUE, value);
				// Statement identities are binders throughout the copied block.
				this.graph = Nodes.retag(binder, Tags.LET, this.node(binder).payload, this.node(binder).provenance)(this.graph);
				this.set(binder, Labels.BODY, build(index + 1));
				return binder;
			});
		};
		return build(0);
	}

	private apply(fn: NodeId, arg: NodeId, calls: ReadonlySet<NodeId>): NodeId {
		const target = this.resolve(fn);
		return match(this.node(target).tag)
			.with(Tags.LAMBDA, () => {
				const origin = this.origin(target);
				if (calls.has(origin)) {
					throw new Error("Effects enrichment: recursive effect regions require runtime activation templates");
				}
				const body = this.copy(this.get(target, Labels.BODY), new Map([[target, arg]]));
				return this.normalize(body, new Set([...calls, origin]));
			})
			.with(Tags.CONTINUATION, () => {
				const resume = this.add(Tags.RESUMPTION, {}, [
					[Labels.INVOKES, target],
					[Labels.ARG, arg],
				]);
				const body = this.get(target, Labels.BODY);
				if (this.control(body)) {
					const residual = this.copy(body, new Map([[this.get(target, Labels.HOLE), arg]]));
					const expanded = this.normalize(residual);
					this.link(resume, Labels.MATERIALIZES, expanded);
					return expanded;
				}
				return resume;
			})
			.otherwise(() =>
				this.add(Tags.APP, {}, [
					[Labels.FUNC, fn],
					[Labels.ARG, arg],
				]),
			);
	}

	private sequence(expr: NodeId, use: (value: NodeId) => NodeId): NodeId {
		return match(this.node(expr).tag)
			.with(Tags.LET, () => {
				this.set(expr, Labels.BODY, this.sequence(this.get(expr, Labels.BODY), use));
				return expr;
			})
			.with(Tags.SWITCH, Tags.LEAF, () => this.tree(expr, body => this.sequence(body, use)))
			.with(Tags.LIT, Tags.LAMBDA, Tags.CONTINUATION, Tags.VAR_BOUND, Tags.VAR_FREE, Tags.VAR_FOREIGN, Tags.BUBBLE, () => use(expr))
			.otherwise(() => {
				const binder = this.add(Tags.LET, {}, [[Labels.VALUE, expr]]);
				this.link(binder, Labels.BODY, use(this.ref(binder)));
				return binder;
			});
	}

	private operands(ids: readonly NodeId[], norm: (id: NodeId) => NodeId, use: (values: NodeId[]) => NodeId, values: NodeId[] = []): NodeId {
		return ids.length === 0 ? use(values) : this.sequence(norm(ids[0]), value => this.operands(ids.slice(1), norm, use, [...values, value]));
	}

	private tree(id: NodeId, transform: (id: NodeId) => NodeId): NodeId {
		return match(this.node(id).tag)
			.with(Tags.LEAF, () => {
				this.set(id, Labels.BODY, transform(this.get(id, Labels.BODY)));
				return id;
			})
			.with(Tags.SWITCH, () => {
				[...this.edges(id, Labels.BRANCH), ...this.edges(id, Labels.DEFAULT)].forEach(e => this.tree(e.target, transform));
				return id;
			})
			.otherwise(() => id);
	}

	private identity(id: NodeId | undefined): string {
		if (id === undefined) {
			return JSON.stringify({ type: "Atom", value: "$anonymous" });
		}
		const target = this.resolve(id);
		const node = this.node(target);
		return match(node.tag)
			.with(Tags.LIT, () => JSON.stringify(node.payload.value))
			.with(Tags.VAR_FOREIGN, Tags.VAR_FREE, () => String(node.payload.name))
			.otherwise(() => {
				throw new Error(`Effects enrichment: dynamic delimiter identity at ${target}`);
			});
	}

	private delimit(body: NodeId, reset: NodeId): NodeId {
		return match(this.node(body).tag)
			.with(Tags.LET, () => {
				const value = this.get(body, Labels.VALUE);
				if (this.node(value).tag === Tags.CAPTURE && this.matches(value, reset)) {
					return this.capture(value, reset, hole => this.copy(this.get(body, Labels.BODY), new Map([[body, hole]])));
				}
				this.set(body, Labels.BODY, this.delimit(this.get(body, Labels.BODY), reset));
				return body;
			})
			.with(Tags.SWITCH, Tags.LEAF, () => this.tree(body, branch => this.delimit(branch, reset)))
			.with(Tags.CAPTURE, () => (this.matches(body, reset) ? this.capture(body, reset, hole => hole) : body))
			.otherwise(() => body);
	}

	private matches(capture: NodeId, reset: NodeId): boolean {
		return this.identity(this.optional(capture, Labels.IDENTITY)) === this.identity(this.optional(reset, Labels.IDENTITY));
	}

	private capture(capture: NodeId, reset: NodeId, rest: (hole: NodeId) => NodeId): NodeId {
		const hole = this.add(Tags.BUBBLE, { binder: `$capture_${capture}` });
		const handler = this.optional(reset, Labels.HANDLER);
		const body = rest(hole);
		const continuation = this.add(Tags.CONTINUATION, {}, [
			[Labels.CAPTURED_AT, this.origin(capture)],
			[Labels.HOLE, hole],
			[Labels.BODY, body],
			[Labels.DELIMITER, reset],
			...(handler === undefined ? [] : [[Labels.HANDLER, handler] as const]),
		]);
		const payload = this.get(capture, Labels.PAYLOAD);
		return handler === undefined
			? this.apply(payload, continuation, new Set())
			: this.sequence(this.apply(handler, payload, new Set()), fn => this.apply(fn, continuation, new Set()));
	}

	private control(id: NodeId): boolean {
		return match(this.node(id).tag)
			.with(Tags.CAPTURE, Tags.RESET, () => true)
			.with(Tags.LET, () => this.control(this.get(id, Labels.VALUE)) || this.control(this.get(id, Labels.BODY)))
			.with(Tags.SWITCH, () => [...this.edges(id, Labels.BRANCH), ...this.edges(id, Labels.DEFAULT)].some(e => this.control(e.target)))
			.with(Tags.LEAF, () => this.control(this.get(id, Labels.BODY)))
			.otherwise(() => false);
	}
}

export const descriptor: Descriptor = {
	name: "effects",
	requires: { tags: new Set([Tags.CAPTURE, Tags.RESET]), labels: new Set([Labels.IDENTITY, Labels.HANDLER, Labels.BODY]) },
	delta: {
		tags: { added: new Set([Tags.BUBBLE, Tags.CONTINUATION, Tags.RESUMPTION]), removed: new Set() },
		labels: {
			added: new Set([Labels.HOLE, Labels.CAPTURED_AT, Labels.DELIMITER, Labels.INVOKES, Labels.DERIVED_FROM, Labels.MATERIALIZES]),
			removed: new Set(),
		},
	},
	run: effects,
};
