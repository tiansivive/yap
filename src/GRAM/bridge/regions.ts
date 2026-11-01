import { match } from "ts-pattern";
import { Edges, Nodes, type Graph, type NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { Constructors as M, type Block, type Instr, type Module, type Terminator } from "../../lowering/mir";
import type { Literal } from "../../shared/literals";

export const emit = (graph: Graph, root: NodeId): Module => new Region(graph).emit(root);

type Cursor = { label: string; params: string[]; instrs: Instr[]; names: ReadonlyMap<NodeId, string> };
type Finish = (value: string, cursor: Cursor) => void;

class Region {
	private blocks: Block[] = [];
	private supply = 0;
	private continuations = new Set<NodeId>();
	private returns = new Map<NodeId, { value: string; target: string; args: string[] }[]>();
	constructor(private readonly graph: Graph) {}

	emit(root: NodeId): Module {
		this.code(root, { label: "entry", params: [], instrs: [], names: new Map() }, (v, c) => this.close(c, M.Terminator.Return(v)));
		const pending = (): void => {
			const ids = [...this.continuations].filter(id => !this.blocks.some(b => b.label === `k${id}`));
			if (ids.length === 0) {
				return;
			}
			ids.forEach(id => this.continuation(id));
			pending();
		};
		pending();
		this.returns.forEach((sites, id) =>
			this.blocks.push(M.Block(`k${id}_return`, [`k${id}_value`, `k${id}_handler`, `k${id}_site`], [], M.Terminator.Branch(`k${id}_site`, sites))),
		);
		return M.Module([M.Function("main", [], "entry", this.blocks)]);
	}

	private fresh(prefix = "v"): string {
		return `${prefix}${this.supply++}`;
	}
	private get(id: NodeId, label: string): NodeId {
		const target = Edges.one(id, label)(this.graph)?.target;
		if (target === undefined) {
			throw new Error(`GRAM bridge: ${id} requires ${label}`);
		}
		return target;
	}
	private node(id: NodeId) {
		return Nodes.get(id)(this.graph)!;
	}
	private edges(id: NodeId, label: string) {
		return [...Edges.byLabel(id, label)(this.graph)].sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0));
	}
	private close(cursor: Cursor, terminator: Terminator) {
		this.blocks.push(M.Block(cursor.label, cursor.params, cursor.instrs, terminator));
	}
	private bind(cursor: Cursor, id: NodeId, name: string): Cursor {
		return { ...cursor, names: new Map([...cursor.names, [id, name]]) };
	}
	private instruction(cursor: Cursor, instr: Instr): Cursor {
		return { ...cursor, instrs: [...cursor.instrs, instr] };
	}

	private code(id: NodeId, cursor: Cursor, finish: Finish): void {
		match(this.node(id).tag)
			.with(Tags.LET, () => this.code(this.get(id, Labels.VALUE), cursor, (v, c) => this.code(this.get(id, Labels.BODY), this.bind(c, id, v), finish)))
			.with(Tags.LEAF, () => {
				const bound = this.edges(id, Labels.BIND).reduce((c, edge) => {
					const [v, next] = this.value(edge.target, c);
					return this.bind(next, edge.payload.binder as number, v);
				}, cursor);
				this.code(this.get(id, Labels.BODY), bound, finish);
			})
			.with(Tags.SWITCH, () => this.branch(id, cursor, finish))
			.with(Tags.RESUMPTION, () => this.resume(id, cursor, finish))
			.otherwise(() => {
				const [v, c] = this.value(id, cursor);
				finish(v, c);
			});
	}

	private value(id: NodeId, cursor: Cursor): [string, Cursor] {
		const existing = cursor.names.get(id);
		if (existing !== undefined) {
			return [existing, cursor];
		}
		const node = this.node(id);
		const name = this.fresh();
		return match(node.tag)
			.with(Tags.VAR_BOUND, Tags.VAR_REF, () => {
				const target = this.get(id, Labels.REFERS_TO);
				const value = cursor.names.get(target);
				if (value === undefined) {
					throw new Error(`GRAM bridge: unavailable captured binding ${target}`);
				}
				return [value, cursor] as [string, Cursor];
			})
			.with(Tags.LIT, () => [name, this.instruction(cursor, M.Instr.Let(name, M.Expr.Lit(node.payload.value as Literal)))] as [string, Cursor])
			.with(
				Tags.VAR_FREE,
				Tags.VAR_FOREIGN,
				() => [name, this.instruction(cursor, M.Instr.Let(name, M.Expr.Lit({ type: "Atom", value: String(node.payload.name) })))] as [string, Cursor],
			)
			.with(Tags.PRIMOP, Tags.EXTERNAL, () => {
				const [args, c] = this.arguments(
					this.edges(id, Labels.ARG).map(e => e.target),
					cursor,
				);
				const instr =
					node.tag === Tags.PRIMOP
						? M.Instr.Let(name, M.Expr.PrimOp(String(node.payload.op), args))
						: M.Instr.Call({ type: "direct", func: String(node.payload.name) }, args, name);
				return [name, this.instruction(c, instr)] as [string, Cursor];
			})
			.with(Tags.STRUCT, () => {
				const fields = this.edges(id, Labels.FIELD);
				const [values, c] = this.arguments(
					fields.map(e => e.target),
					cursor,
				);
				return [
					name,
					this.instruction(c, M.Instr.Alloc({ type: "Record", fields: fields.map((e, i) => ({ label: String(e.payload.label), value: values[i] })) }, name)),
				] as [string, Cursor];
			})
			.with(Tags.PROJ, () => {
				const [target, c] = this.value(this.get(id, Labels.TARGET), cursor);
				return [name, this.instruction(c, M.Instr.Read(String(node.payload.label), target, name))] as [string, Cursor];
			})
			.with(Tags.INJ, () => {
				const [values, c] = this.arguments([this.get(id, Labels.VALUE), this.get(id, Labels.TARGET)], cursor);
				return [
					name,
					this.instruction(c, M.Instr.UpdateImmutable(values[1], name, { type: "Record", fields: [{ label: String(node.payload.label), value: values[0] }] })),
				] as [string, Cursor];
			})
			.with(Tags.LAMBDA, Tags.CONTINUATION, () => {
				throw new Error("GRAM bridge: escaping functions or continuations require reification");
			})
			.with(Tags.CAPTURE, () => {
				throw new Error("GRAM bridge: capture requires an active delimiter in this region");
			})
			.otherwise(() => {
				throw new Error(`GRAM bridge: residual ${node.tag} requires region lowering`);
			});
	}

	private arguments(ids: readonly NodeId[], cursor: Cursor): [string[], Cursor] {
		return ids.reduce<[string[], Cursor]>(
			([args, c], id) => {
				const [v, next] = this.value(id, c);
				return [[...args, v], next];
			},
			[[], cursor],
		);
	}

	private branch(id: NodeId, cursor: Cursor, finish: Finish): void {
		const [scrutinee, c] = this.value(this.get(id, Labels.INSPECT), cursor);
		const kind = this.node(id).payload.kind;
		if (kind === "struct") {
			this.code(this.get(id, Labels.BRANCH), c, finish);
			return;
		}
		const tag = kind === "tag" ? this.fresh("tag") : scrutinee;
		const before = kind === "tag" ? this.instruction(c, M.Instr.Read("__tag", scrutinee, tag)) : c;
		const branches = this.edges(id, Labels.BRANCH).map(edge => {
			const label = this.fresh("case");
			this.code(edge.target, { ...c, label, params: [], instrs: [] }, finish);
			const literal = edge.payload.value as Literal | undefined;
			const value = kind === "tag" ? String(edge.payload.label) : String(literal && "value" in literal ? literal.value : literal);
			return { value, target: label, args: [] };
		});
		const fallback = Edges.one(id, Labels.DEFAULT)(this.graph);
		const target = fallback === undefined ? undefined : this.fresh("default");
		if (fallback !== undefined && target !== undefined) {
			this.code(fallback.target, { ...c, label: target, params: [], instrs: [] }, finish);
		}
		this.close(before, M.Terminator.Branch(tag, branches, target === undefined ? undefined : { target, args: [] }));
	}

	private captures(id: NodeId): NodeId[] {
		const env = Edges.one(id, Labels.ENV)(this.graph)?.target;
		return env === undefined ? [] : this.edges(env, Labels.CAPTURE).map(e => e.target);
	}

	private resume(id: NodeId, cursor: Cursor, finish: Finish): void {
		const k = this.get(id, Labels.INVOKES);
		this.continuations.add(k);
		const [arg, c] = this.value(this.get(id, Labels.ARG), cursor);
		const captured = this.captures(k).map(binder => {
			const value = c.names.get(binder);
			if (value === undefined) {
				throw new Error(`GRAM bridge: missing continuation capture ${binder}`);
			}
			return { label: `v${binder}`, value };
		});
		const kenv = this.fresh("kenv");
		const henv = this.fresh("henv");
		const site = this.fresh("site");
		const after = this.fresh("after");
		const result = this.fresh("resumed");
		const restored = this.fresh("saved");
		const cases = this.returns.get(k) ?? [];
		this.returns.set(k, [...cases, { value: String(cases.length), target: after, args: [`k${k}_value`, `k${k}_handler`] }]);
		const instructions = [
			M.Instr.Alloc({ type: "Record", fields: captured }, kenv),
			M.Instr.Alloc({ type: "Record", fields: [...c.names].map(([binder, value]) => ({ label: `v${binder}`, value })) }, henv),
			M.Instr.Let(site, M.Expr.Lit({ type: "Num", value: cases.length })),
		];
		this.close({ ...c, instrs: [...c.instrs, ...instructions] }, M.Terminator.Jump(`k${k}`, [arg, kenv, henv, site]));
		const next = [...c.names].reduce<Cursor>(
			(acc, [binder]) => {
				const name = this.fresh("saved");
				return this.bind(this.instruction(acc, M.Instr.Read(`v${binder}`, restored, name)), binder, name);
			},
			{ label: after, params: [result, restored], instrs: [], names: new Map() },
		);
		finish(result, next);
	}

	private continuation(id: NodeId): void {
		const hole = this.get(id, Labels.HOLE);
		const cursor = this.captures(id).reduce<Cursor>(
			(c, binder) => {
				const name = this.fresh("captured");
				return this.bind(this.instruction(c, M.Instr.Read(`v${binder}`, `k${id}_captured`, name)), binder, name);
			},
			{
				label: `k${id}`,
				params: [`k${id}_hole`, `k${id}_captured`, `k${id}_caller`, `k${id}_index`],
				instrs: [],
				names: new Map([
					[hole, `k${id}_hole`],
					[-1, `k${id}_caller`],
					[-2, `k${id}_index`],
				]),
			},
		);
		this.code(this.get(id, Labels.BODY), cursor, (value, c) => this.close(c, M.Terminator.Jump(`k${id}_return`, [value, c.names.get(-1)!, c.names.get(-2)!])));
	}
}
