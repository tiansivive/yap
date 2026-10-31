import { match } from "ts-pattern";
import { Nodes, Edges, Query, entry, type Graph, type NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Descriptor } from "../pipeline/descriptor";
import { ARITIES } from "../../lowering/shared/primops";
import type { Literal } from "../../shared/literals";

export type Operation =
	| { type: "literal"; result: number; value: Literal }
	| { type: "primitive"; result: number; op: string; args: number[] }
	| { type: "record"; result: number; fields: { label: string; value: number }[] };

export type State = { name: string; params: number[]; operations: Operation[]; args: number[]; result?: number };

type Cell = { value?: Value };
type Env = ReadonlyMap<NodeId | `field:${NodeId}`, Cell>;
type Value =
	| { type: "literal"; value: Literal }
	| { type: "register"; slot: number }
	| { type: "closure"; node: NodeId; env: Env }
	| { type: "continuation"; frames: Frame[] }
	| { type: "primitive"; name: string; args: Value[] }
	| { type: "record"; fields: ReadonlyMap<string, Value> };
type Task = { node: NodeId; env: Env; field?: Cell };
type Finish =
	| { type: "app" }
	| { type: "primitive"; name: string }
	| { type: "reset"; body: Task; named: boolean; handled: boolean }
	| { type: "capture" }
	| { type: "projection"; label: string }
	| { type: "record"; labels: string[] };
type Frame =
	| { type: "collect"; rest: Task[]; values: Value[]; finish: Finish }
	| { type: "delimiter"; identity: string; handler?: Value }
	| { type: "argument"; value: Value }
	| { type: "binding"; binder: NodeId; cell: Cell; env: Env; rest: NodeId[]; body: NodeId }
	| { type: "sequence"; env: Env; rest: NodeId[]; body: NodeId }
	| { type: "field"; cell: Cell }
	| { type: "return" };

const unsupported = (message: string): never => {
	throw new Error(`Effects lowering: ${message}`);
};

/** Resolve local control flow while leaving value computations as graph operations. */
export const effects = (graph: Graph): Graph => {
	if (![...Query.byTag(Tags.CAPTURE)(graph)].length) {
		return graph;
	}
	const root = entry(graph);

	if (root === undefined) {
		return graph;
	}
	return new Flow(graph).build(root);
};

class Flow {
	private task?: Task;
	private value?: Value;
	private stack: Frame[] = [];
	private states: State[] = [];
	private slots: number[] = [];
	private state: State = { name: "entry", params: [], operations: [], args: [] };
	private fuel = 10000;

	constructor(private readonly graph: Graph) {}

	build(root: NodeId): Graph {
		this.task = { node: root, env: new Map() };
		while (this.task || this.stack.length) {
			if (--this.fuel === 0) {
				unsupported("local control analysis exceeded its limit; recursive control flow needs a shared runtime state");
			}
			if (this.task) {
				const task = this.task;
				this.task = undefined;
				this.evaluate(task);
			} else {
				const frame = this.stack.shift()!;
				this.deliver(frame, this.value!);
			}
		}
		this.state.result = this.register(this.value!);
		this.states.push(this.state);
		let g = this.graph;
		let previous: NodeId | undefined;
		for (const state of this.states) {
			const [id, next] = Nodes.add(Tags.EFFECT_STATE, { ...state }, { created_by: "effects" })(g);
			g = previous === undefined ? Edges.add(g.root, Labels.MACHINE, id)(next) : Edges.add(previous, Labels.NEXT, id)(next);
			previous = id;
		}
		return g;
	}

	private follow(node: NodeId, label: string): NodeId {
		return Query.follow(node, label)(this.graph) ?? unsupported(`missing ${label} edge on ${node}`);
	}

	private sorted(node: NodeId, label: string): NodeId[] {
		return [...Edges.byLabel(node, label)(this.graph)].sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0)).map(e => e.target);
	}

	private evaluate(task: Task): void {
		const { node: id, env } = task;

		if (task.field) {
			this.stack.unshift({ type: "field", cell: task.field });
		}
		const node = Nodes.get(id)(this.graph)!;
		const at = (node: NodeId): Task => ({ node, env });
		match(node.tag)
			.with(Tags.LIT, () => {
				this.value = { type: "literal", value: node.payload.value as Literal };
			})
			.with(Tags.LAMBDA, () => {
				this.value = { type: "closure", node: id, env };
			})
			.with(Tags.CLOSURE, Tags.NU, () => {
				this.task = at(this.follow(id, Labels.BODY));
			})
			.with(Tags.MODAL, () => {
				this.task = at(this.follow(id, Labels.TERM));
			})
			.with(Tags.VAR_BOUND, () => {
				const target = this.follow(id, Labels.REFERS_TO);
				this.value = env.get(target)?.value ?? unsupported(`unavailable binding ${target}`);
			})
			.with(Tags.VAR_REF, () => {
				this.task = at(this.follow(id, Labels.REFERS_TO));
			})
			.with(Tags.VAR_LABEL, Tags.VAR_NU_LABEL, () => {
				const target = this.follow(id, Labels.REFERS_TO);
				this.value = env.get(`field:${target}`)?.value ?? unsupported(`unavailable field ${target}`);
			})
			.with(Tags.VAR_FOREIGN, Tags.VAR_FREE, () => {
				const name = String(node.payload.name);
				this.value = ARITIES[name] === undefined ? { type: "literal", value: { type: "Atom", value: name } } : { type: "primitive", name, args: [] };
			})
			.with(Tags.APP, () => this.collect([at(this.follow(id, Labels.FUNC)), at(this.follow(id, Labels.ARG))], { type: "app" }))
			.with(Tags.PRIMOP, () => this.collect(this.sorted(id, Labels.ARG).map(at), { type: "primitive", name: String(node.payload.op) }))
			.with(Tags.EXTERNAL, () => {
				const name = String(node.payload.name);
				const args = this.sorted(id, Labels.ARG);

				if (args.length === Number(node.payload.arity)) {
					this.collect(args.map(at), { type: "primitive", name });
				} else {
					unsupported("partially applied external functions require closure materialization");
				}
			})
			.with(Tags.BLOCK, () => this.sequence(this.sorted(id, Labels.STMT), this.follow(id, Labels.RETURN), env))
			.with(Tags.LET, () => this.bind(id, [], this.follow(id, Labels.BODY), env))
			.with(Tags.RESET, () => {
				const identity = Query.follow(id, Labels.IDENTITY)(this.graph);
				const handler = Query.follow(id, Labels.HANDLER)(this.graph);
				this.collect([...(identity === undefined ? [] : [at(identity)]), ...(handler === undefined ? [] : [at(handler)])], {
					type: "reset",
					body: at(this.follow(id, Labels.BODY)),
					named: identity !== undefined,
					handled: handler !== undefined,
				});
			})
			.with(Tags.CAPTURE, () => this.collect([at(this.follow(id, Labels.IDENTITY)), at(this.follow(id, Labels.PAYLOAD))], { type: "capture" }))
			.with(Tags.PROJ, () => this.collect([at(this.follow(id, Labels.TARGET))], { type: "projection", label: String(node.payload.label) }))
			.with(Tags.STRUCT, () => {
				const fields = Edges.byLabel(id, Labels.FIELD)(this.graph);
				const cells = fields.map((): Cell => ({}));
				const within = new Map(env);
				fields.forEach((field, i) => within.set(`field:${field.target}`, cells[i]));
				this.collect(
					fields.map((field, i) => ({ node: field.target, env: within, field: cells[i] })),
					{ type: "record", labels: fields.map(f => String(f.payload.label)) },
				);
			})
			.with(Tags.PI, Tags.SIGMA, Tags.SIGMA_V2, Tags.MU, Tags.VAR_META, Tags.ROW_EMPTY, () => {
				this.value = { type: "literal", value: { type: "Atom", value: "Unit" } };
			})
			.otherwise(() => unsupported(`local control analysis does not yet cover ${node.tag}`));
	}

	private collect(tasks: Task[], finish: Finish): void {
		if (!tasks.length) {
			this.finish(finish, []);
			return;
		}
		const [first, ...rest] = tasks;
		this.stack.unshift({ type: "collect", rest, values: [], finish });
		this.task = first;
	}

	private deliver(frame: Frame, value: Value): void {
		match(frame)
			.with({ type: "collect" }, ({ rest, values, finish }) => {
				const collected = [...values, value];

				if (rest.length) {
					this.stack.unshift({ type: "collect", rest: rest.slice(1), values: collected, finish });
					this.task = rest[0];
				} else {
					this.finish(finish, collected);
				}
			})
			.with({ type: "argument" }, frame => this.apply(value, frame.value))
			.with({ type: "delimiter" }, () => {
				this.boundary("reset_exit");
				this.value = value;
			})
			.with({ type: "return" }, () => {
				this.boundary("resume_return");
				this.value = value;
			})
			.with({ type: "binding" }, ({ binder, cell, env, rest, body }) => {
				cell.value = value;
				this.sequence(rest, body, new Map(env).set(binder, { value }));
			})
			.with({ type: "sequence" }, ({ env, rest, body }) => this.sequence(rest, body, env))
			.with({ type: "field" }, ({ cell }) => {
				cell.value = value;
				this.value = value;
			})
			.exhaustive();
	}

	private finish(finish: Finish, values: Value[]): void {
		match(finish)
			.with({ type: "app" }, () => this.apply(values[0], values[1]))
			.with({ type: "primitive" }, ({ name }) => {
				this.value = this.primitive(name, values);
			})
			.with({ type: "reset" }, ({ body, named, handled }) => {
				const identity = named ? this.identity(values[0]) : "$anonymous";
				const handler = handled ? values[named ? 1 : 0] : undefined;
				this.stack.unshift({ type: "delimiter", identity, handler });
				this.boundary("reset");
				this.task = body;
			})
			.with({ type: "capture" }, () => {
				const identity = this.identity(values[0]);
				const index = this.stack.findIndex(f => f.type === "delimiter" && f.identity === identity);

				if (index < 0) {
					unsupported(`capture requires a live delimiter for ${identity}`);
				}
				const delimiter = this.stack[index] as Extract<Frame, { type: "delimiter" }>;
				const k: Value = { type: "continuation", frames: this.stack.slice(0, index) };
				this.stack = this.stack.slice(index + 1);
				this.boundary("capture");

				if (delimiter.handler) {
					this.stack.unshift({ type: "argument", value: k });
					this.apply(delimiter.handler, values[1]);
				} else {
					this.apply(values[1], k);
				}
			})
			.with({ type: "projection" }, ({ label }) => {
				const record = values[0];
				this.value =
					record.type === "record"
						? (record.fields.get(label) ?? unsupported(`missing field ${label}`))
						: unsupported("dynamic projection requires value-flow analysis");
			})
			.with({ type: "record" }, ({ labels }) => {
				this.value = { type: "record", fields: new Map(labels.map((l, i) => [l, values[i]])) };
			})
			.exhaustive();
	}

	private apply(func: Value, arg: Value): void {
		match(func)
			.with({ type: "closure" }, ({ node, env }) => {
				this.task = { node: this.follow(node, Labels.BODY), env: new Map(env).set(node, { value: arg }) };
			})
			.with({ type: "continuation" }, ({ frames }) => {
				this.stack = [...frames, { type: "return" }, ...this.stack];
				this.boundary("resume");
				this.value = arg;
			})
			.with({ type: "primitive" }, ({ name, args }) => {
				const supplied = [...args, arg];
				this.value = supplied.length === ARITIES[name] ? this.primitive(name, supplied) : { type: "primitive", name, args: supplied };
			})
			.otherwise(() => unsupported("calling a dynamic function requires continuation reification"));
	}

	private sequence(statements: NodeId[], body: NodeId, env: Env): void {
		if (!statements.length) {
			this.task = { node: body, env };
			return;
		}
		const [first, ...rest] = statements;

		if (Nodes.get(first)(this.graph)!.tag === Tags.STMT_LET) {
			this.bind(first, rest, body, env);
		} else {
			this.stack.unshift({ type: "sequence", env, rest, body });
			this.task = { node: this.follow(first, Labels.VALUE), env };
		}
	}

	private bind(binder: NodeId, rest: NodeId[], body: NodeId, env: Env): void {
		const cell: Cell = {};
		const within = new Map(env).set(binder, cell);
		this.stack.unshift({ type: "binding", binder, cell, env: within, rest, body });
		this.task = { node: this.follow(binder, Labels.VALUE), env: within };
	}

	private identity(value: Value): string {
		return value.type === "literal" && value.value.type === "Atom" ? value.value.value : unsupported("dynamic identities require continuation reification");
	}

	private primitive(op: string, values: Value[]): Value {
		const args = values.map(v => this.register(v));
		const result = this.slots.length;
		this.slots.push(result);
		this.state.operations.push({ type: "primitive", result, op, args });
		return { type: "register", slot: result };
	}

	private register(value: Value): number {
		if (value.type === "register") {
			return value.slot;
		}
		if (value.type === "literal") {
			const result = this.slots.length;
			this.slots.push(result);
			this.state.operations.push({ type: "literal", result, value: value.value });
			return result;
		}
		if (value.type === "record") {
			const fields = [...value.fields].map(([label, value]) => ({ label, value: this.register(value) }));
			const result = this.slots.length;
			this.slots.push(result);
			this.state.operations.push({ type: "record", result, fields });
			return result;
		}
		return unsupported("escaping functions or continuations require reification");
	}

	private boundary(name: string): void {
		this.state.args = [...this.slots];
		this.states.push(this.state);
		this.state = { name: `${name}_${this.states.length}`, params: [...this.slots], operations: [], args: [] };
	}
}

export const descriptor: Descriptor = {
	name: "effects",
	requires: { tags: new Set([Tags.RESET, Tags.CAPTURE]), labels: new Set([Labels.HANDLER, Labels.IDENTITY, Labels.PAYLOAD]) },
	delta: { tags: { added: new Set([Tags.EFFECT_STATE]), removed: new Set() }, labels: { added: new Set([Labels.MACHINE]), removed: new Set() } },
	run: effects,
};
