import { match } from "ts-pattern";
import { Edges, Nodes, type Graph, type NodeId } from "../graph";
import { Labels } from "../vocabulary";
import type { State } from "../passes/effects";
import { Constructors as C, type Block, type Instr, type Module } from "../../lowering/mir";

export const emit = (graph: Graph, first: NodeId): Module => {
	const blocks: Block[] = [];
	let current: NodeId | undefined = first;
	while (current !== undefined) {
		const state = Nodes.get(current)(graph)!.payload as unknown as State;
		const next: NodeId | undefined = Edges.one(current, Labels.NEXT)(graph)?.target;
		const local = (slot: number) => `v${slot}_${current}`;
		const instructions = state.operations.map<Instr>(operation =>
			match(operation)
				.with({ type: "literal" }, o => C.Instr.Let(local(o.result), C.Expr.Lit(o.value)))
				.with({ type: "primitive" }, o => C.Instr.Let(local(o.result), C.Expr.PrimOp(o.op, o.args.map(local))))
				.with({ type: "record" }, o =>
					C.Instr.Alloc({ type: "Record", fields: o.fields.map(f => ({ label: f.label, value: local(f.value) })) }, local(o.result)),
				)
				.exhaustive(),
		);
		const terminator =
			next === undefined ? C.Terminator.Return(local(state.result!)) : C.Terminator.Jump(String(Nodes.get(next)(graph)!.payload.name), state.args.map(local));
		blocks.push(C.Block(state.name, state.params.map(local), instructions, terminator));
		current = next;
	}
	return C.Module([C.Function("main", [], blocks[0].label, blocks)]);
};
