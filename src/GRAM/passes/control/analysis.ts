import { match, P } from "ts-pattern";
import { Edges, Nodes, type Graph, type NodeId, type Payload } from "../../graph";
import { Labels, Tags } from "../../vocabulary";

export type Scope = ReadonlyMap<NodeId, Term>;
export type Term =
	| { kind: "source"; id: NodeId }
	| { kind: "closure"; id: NodeId; scope: Scope }
	| { kind: "variable"; key: symbol; value?: Term }
	| { kind: "binding"; key: symbol; value: Term; body: Term }
	| { kind: "operation"; id: NodeId; tag?: string; edges: readonly { label: string; value: Term; payload: Payload }[] }
	| { kind: "capture"; id: NodeId; identity: Term; payload: Term }
	| { kind: "continuation"; id: NodeId; reset: NodeId; hole: Term & { kind: "variable" }; body: Term; handler?: Term }
	| { kind: "resumption"; id: NodeId; continuation: Term & { kind: "continuation" }; arg: Term }
	| { kind: "decision"; id: NodeId; inspect: Term; branches: readonly { value: Term; payload: Payload }[]; fallback?: Term }
	| { kind: "leaf"; id: NodeId; bindings: readonly { value: Term; payload: Payload }[]; body: Term };

const source = (id: NodeId): Term => ({ kind: "source", id });
const head = (term: Term): Term => (term.kind === "variable" && term.value ? head(term.value) : term);

/** Analyze the dependencies within a delimiter. All references point into the input graph. */
export const analyze = (id: NodeId, graph: Graph): { entry: Term; continuations: readonly (Term & { kind: "continuation" })[] } => {
	const continuations = new Set<Term & { kind: "continuation" }>();
	const node = (id: NodeId) => {
		const value = Nodes.get(id)(graph);
		if (value === undefined) {
			throw new Error(`Control analysis: missing node ${id}`);
		}
		return value;
	};
	const edges = (id: NodeId, label: string) => [...Edges.byLabel(id, label)(graph)].sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0));
	const optional = (id: NodeId, label: string) => Edges.one(id, label)(graph)?.target;
	const get = (id: NodeId, label: string) => {
		const target = optional(id, label);
		if (target === undefined) {
			throw new Error(`Control analysis: ${id} requires ${label}`);
		}
		return target;
	};

	const bind = (term: Term, use: (value: Term) => Term): Term =>
		match(term)
			.with({ kind: "binding" }, t => ({ ...t, body: bind(t.body, use) }))
			.with({ kind: "decision" }, t => ({
				...t,
				branches: t.branches.map(b => ({ ...b, value: bind(b.value, use) })),
				fallback: t.fallback && bind(t.fallback, use),
			}))
			.with({ kind: "leaf" }, t => ({ ...t, body: bind(t.body, use) }))
			.with({ kind: "source" }, { kind: "closure" }, { kind: "variable" }, { kind: "continuation" }, use)
			.otherwise(value => {
				const key = Symbol("value");
				const body = use({ kind: "variable", key, value });
				return value.kind === "operation" && node(value.id).tag === Tags.STRUCT && !uses(body, key) ? body : { kind: "binding", key, value, body };
			});

	const operands = (ids: readonly NodeId[], scope: Scope, calls: ReadonlySet<NodeId>, use: (values: Term[]) => Term, values: Term[] = []): Term =>
		ids.length === 0 ? use(values) : bind(visit(ids[0], scope, calls), value => operands(ids.slice(1), scope, calls, use, [...values, value]));

	const known = (id: NodeId, scope: Scope, seen: ReadonlySet<NodeId> = new Set()): Term | undefined => {
		const binding = scope.get(id);
		if (binding && node(id).tag !== Tags.LAMBDA) {
			return binding;
		}
		if (seen.has(id)) {
			return undefined;
		}
		const next = new Set([...seen, id]);
		return match(node(id).tag)
			.with(Tags.LAMBDA, () => ({ kind: "closure" as const, id, scope }))
			.with(Tags.MODAL, () => known(get(id, Labels.TERM), scope, next))
			.with(Tags.NU, Tags.CLOSURE, () => known(get(id, Labels.BODY), scope, next))
			.with(Tags.VAR_BOUND, () => {
				const binder = get(id, Labels.REFERS_TO);
				return scope.get(binder) ?? (node(binder).tag === Tags.LAMBDA ? undefined : known(binder, scope, next));
			})
			.with(Tags.VAR_REF, Tags.VAR_LABEL, Tags.VAR_NU_LABEL, () => known(get(id, Labels.REFERS_TO), scope, next))
			.with(Tags.LET, Tags.STMT_LET, () => known(get(id, Labels.VALUE), scope, next))
			.with(Tags.STRUCT, Tags.APP, Tags.PROJ, Tags.RESET, Tags.BLOCK, () => visit(id, scope, next))
			.otherwise(() => undefined);
	};

	const application = (id: NodeId, fn: Term, arg: Term, calls: ReadonlySet<NodeId>): Term => {
		const resolved = head(fn);
		return match(resolved)
			.returnType<Term>()
			.with({ kind: "source" }, t => {
				const target = known(t.id, new Map());
				return target
					? application(id, target, arg, calls)
					: {
							...operation(id, [
								[Labels.FUNC, fn],
								[Labels.ARG, arg],
							]),
							tag: Tags.APP,
						};
			})
			.with({ kind: "closure" }, t => {
				if (calls.has(t.id)) {
					throw new Error("Control analysis: recursive effectful calls require activation enrichment");
				}
				return visit(get(t.id, Labels.BODY), new Map([...t.scope, [t.id, arg]]), new Set([...calls, t.id]));
			})
			.with({ kind: "continuation" }, continuation => {
				const body = substitute(continuation.body, continuation.hole.key, arg);
				return captures(body) ? body : { kind: "resumption", id, continuation, arg };
			})
			.otherwise(() => ({
				...operation(id, [
					[Labels.FUNC, fn],
					[Labels.ARG, arg],
				]),
				tag: Tags.APP,
			}));
	};

	const operation = (id: NodeId, operands: readonly (readonly [string, Term, Payload?])[]): Term => ({
		kind: "operation",
		id,
		edges: operands.map(([label, value, payload]) => ({ label, value, payload: payload ?? {} })),
	});

	const visit = (id: NodeId, scope: Scope, calls: ReadonlySet<NodeId> = new Set()): Term => {
		const value = node(id);
		return match(value.tag)
			.returnType<Term>()
			.with(Tags.LAMBDA, () => ({ kind: "closure", id, scope }))
			.with(Tags.VAR_BOUND, () => scope.get(get(id, Labels.REFERS_TO)) ?? known(id, scope) ?? source(id))
			.with(Tags.VAR_REF, () => visit(get(id, Labels.REFERS_TO), scope, calls))
			.with(Tags.VAR_LABEL, Tags.VAR_NU_LABEL, () => scope.get(get(id, Labels.REFERS_TO)) ?? known(id, scope) ?? source(id))
			.with(Tags.MODAL, () => visit(get(id, Labels.TERM), scope, calls))
			.with(Tags.NU, Tags.CLOSURE, () => visit(get(id, Labels.BODY), scope, calls))
			.with(Tags.BLOCK, () => {
				const statements = edges(id, Labels.STMT);
				const statementsAt = (index: number, within: Scope): Term =>
					index === statements.length
						? visit(get(id, Labels.RETURN), within, calls)
						: bind(visit(get(statements[index].target, Labels.VALUE), within, calls), term =>
								statementsAt(index + 1, new Map([...within, [statements[index].target, term]])),
							);
				return statementsAt(0, scope);
			})
			.with(Tags.LET, () => bind(visit(get(id, Labels.VALUE), scope, calls), term => visit(get(id, Labels.BODY), new Map([...scope, [id, term]]), calls)))
			.with(Tags.APP, () => operands([get(id, Labels.FUNC), get(id, Labels.ARG)], scope, calls, ([fn, arg]) => application(id, fn, arg, calls)))
			.with(Tags.PROJ, () =>
				bind(visit(get(id, Labels.TARGET), scope, calls), target => {
					const resolved = head(target);
					const record = resolved.kind === "source" ? head(known(resolved.id, scope) ?? resolved) : resolved;
					const field = record.kind === "operation" ? record.edges.find(e => e.label === Labels.FIELD && e.payload.label === value.payload.label) : undefined;
					return field?.value ?? operation(id, [[Labels.TARGET, target]]);
				}),
			)
			.with(Tags.PRIMOP, Tags.EXTERNAL, Tags.STRUCT, Tags.INJ, () => {
				const operandsEdges =
					value.tag === Tags.INJ ? [...edges(id, Labels.VALUE), ...edges(id, Labels.TARGET)] : edges(id, value.tag === Tags.STRUCT ? Labels.FIELD : Labels.ARG);
				return operands(
					operandsEdges.map(e => e.target),
					scope,
					calls,
					values =>
						operation(
							id,
							operandsEdges.map((e, i) => [e.label, values[i], e.payload]),
						),
				);
			})
			.with(Tags.CAPTURE, () =>
				operands([get(id, Labels.IDENTITY), get(id, Labels.PAYLOAD)], scope, calls, ([identity, payload]) => ({ kind: "capture", id, identity, payload })),
			)
			.with(Tags.SHIFT, () => ({ kind: "capture", id, identity: source(-1), payload: visit(get(id, Labels.BODY), scope, calls) }))
			.with(Tags.RESET, () => {
				const identity = optional(id, Labels.IDENTITY);
				const handler = optional(id, Labels.HANDLER);
				return operands(
					[identity, handler].filter((x): x is number => x !== undefined),
					scope,
					calls,
					values =>
						delimit(
							visit(get(id, Labels.BODY), scope, calls),
							id,
							identity === undefined ? source(-1) : values[0],
							handler === undefined ? undefined : values[identity === undefined ? 0 : 1],
						),
				);
			})
			.with(Tags.MATCH, () =>
				bind(visit(get(id, Labels.SCRUTINEE), scope, calls), scrutinee =>
					visit(get(id, Labels.DECISION_TREE), new Map([...scope, [get(id, Labels.SCRUTINEE), scrutinee]]), calls),
				),
			)
			.with(Tags.SWITCH, () => ({
				kind: "decision",
				id,
				inspect: scope.get(get(id, Labels.INSPECT)) ?? visit(get(id, Labels.INSPECT), scope, calls),
				branches: edges(id, Labels.BRANCH).map(e => ({ value: visit(e.target, scope, calls), payload: e.payload })),
				fallback: optional(id, Labels.DEFAULT) === undefined ? undefined : visit(get(id, Labels.DEFAULT), scope, calls),
			}))
			.with(Tags.LEAF, () => ({
				kind: "leaf",
				id,
				bindings: edges(id, Labels.BIND).map(e => ({ value: scope.get(e.target) ?? visit(e.target, scope, calls), payload: e.payload })),
				body: visit(get(id, Labels.BODY), scope, calls),
			}))
			.otherwise(() => scope.get(id) ?? source(id));
	};

	const identity = (term: Term): string => {
		const value = head(term);
		if (value.kind !== "source") {
			throw new Error("Control analysis: identity requires a resolved evidence reference");
		}
		if (value.id === -1) {
			return "$anonymous";
		}
		const n = node(value.id);
		return match(n.payload)
			.with({ value: { type: "Atom", value: P.string } }, p => p.value.value)
			.with({ name: P.string }, p => p.name)
			.otherwise(() => {
				throw new Error(`Control analysis: identity ${value.id} requires resolved evidence`);
			});
	};

	const capture = (term: Term & { kind: "capture" }, reset: NodeId, body: (hole: Term & { kind: "variable" }) => Term, handler?: Term): Term => {
		const hole = { kind: "variable" as const, key: Symbol("hole") };
		const continuation = { kind: "continuation" as const, id: term.id, reset, hole, body: body(hole), handler: handler ?? term.payload };
		continuations.add(continuation);
		return handler === undefined
			? application(term.id, term.payload, continuation, new Set())
			: bind(application(term.id, handler, term.payload, new Set()), fn => application(term.id, fn, continuation, new Set()));
	};

	const delimit = (body: Term, reset: NodeId, token: Term, handler?: Term): Term =>
		match(body)
			.with({ kind: "binding" }, t =>
				t.value.kind === "capture" && identity(t.value.identity) === identity(token)
					? capture(t.value, reset, hole => substitute(t.body, t.key, hole), handler)
					: { ...t, body: delimit(t.body, reset, token, handler) },
			)
			.with({ kind: "capture" }, t => (identity(t.identity) === identity(token) ? capture(t, reset, hole => hole, handler) : t))
			.with({ kind: "decision" }, t => ({
				...t,
				branches: t.branches.map(b => ({ ...b, value: delimit(b.value, reset, token, handler) })),
				fallback: t.fallback && delimit(t.fallback, reset, token, handler),
			}))
			.with({ kind: "leaf" }, t => ({ ...t, body: delimit(t.body, reset, token, handler) }))
			.otherwise(t => t);

	const entry = visit(id, new Map());
	return { entry, continuations: [...continuations] };
};

const substitute = (term: Term, key: symbol, value: Term): Term =>
	match(term)
		.with({ kind: "variable" }, t => (t.key === key ? value : t))
		.with({ kind: "binding" }, t => ({ ...t, value: substitute(t.value, key, value), body: substitute(t.body, key, value) }))
		.with({ kind: "operation" }, t => ({ ...t, edges: t.edges.map(e => ({ ...e, value: substitute(e.value, key, value) })) }))
		.with({ kind: "capture" }, t => ({ ...t, identity: substitute(t.identity, key, value), payload: substitute(t.payload, key, value) }))
		.with({ kind: "resumption" }, t => ({ ...t, arg: substitute(t.arg, key, value) }))
		.with({ kind: "closure" }, t => ({ ...t, scope: new Map([...t.scope].map(([id, v]) => [id, substitute(v, key, value)])) }))
		.with({ kind: "decision" }, t => ({
			...t,
			inspect: substitute(t.inspect, key, value),
			branches: t.branches.map(b => ({ ...b, value: substitute(b.value, key, value) })),
			fallback: t.fallback && substitute(t.fallback, key, value),
		}))
		.with({ kind: "leaf" }, t => ({
			...t,
			bindings: t.bindings.map(b => ({ ...b, value: substitute(b.value, key, value) })),
			body: substitute(t.body, key, value),
		}))
		.otherwise(t => t);

const captures = (term: Term): boolean =>
	match(term)
		.with({ kind: "capture" }, () => true)
		.with({ kind: "binding" }, t => captures(t.value) || captures(t.body))
		.with({ kind: "decision" }, t => t.branches.some(b => captures(b.value)) || (!!t.fallback && captures(t.fallback)))
		.with({ kind: "leaf" }, t => captures(t.body))
		.otherwise(() => false);

export const uses = (term: Term, key: symbol): boolean =>
	match(term)
		.with({ kind: "variable" }, t => t.key === key)
		.with({ kind: "binding" }, t => uses(t.value, key) || uses(t.body, key))
		.with({ kind: "operation" }, t => t.edges.some(e => uses(e.value, key)))
		.with({ kind: "capture" }, t => uses(t.identity, key) || uses(t.payload, key))
		.with({ kind: "resumption" }, t => uses(t.arg, key) || uses(t.continuation.body, key))
		.with({ kind: "continuation" }, t => uses(t.body, key))
		.with({ kind: "closure" }, t => [...t.scope.values()].some(v => uses(v, key)))
		.with({ kind: "decision" }, t => uses(t.inspect, key) || t.branches.some(b => uses(b.value, key)) || (!!t.fallback && uses(t.fallback, key)))
		.with({ kind: "leaf" }, t => t.bindings.some(b => uses(b.value, key)) || uses(t.body, key))
		.otherwise(() => false);
