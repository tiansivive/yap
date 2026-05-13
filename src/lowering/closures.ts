import * as MIR from "./mir";
import * as M from "./monad";
import type * as C from "./context";

const { Block, Instr, Expr: E, Terminator: T, Function: Fn } = MIR.Constructors;

export function* convert(
	ctx: C.LowerCtx,
	fnName: string,
	params: string[],
	body: { instrs: MIR.Instr[]; result: M.ValueResult },
	captured: C.Stamped[],
): M.Glowering<C.Stamped> {
	const block = Block(`${fnName}_entry`, [], body.instrs, T.Return(body.result.value.name));
	yield* M.Functions.emit(Fn(fnName, params, block.label, [block]));

	const { instrs, closureRef } = bundle(ctx, fnName, captured);
	yield* M.Pending.appendMany(instrs);
	return closureRef;
}

/** Package a function reference + captured args into a closure triple (env alloc, fnref, closure alloc). */
export const bundle = (ctx: C.LowerCtx, fnName: string, captured: C.Stamped[]) => {
	const envRef = ctx.nextVar("env");
	const fnRef = ctx.nextVar("fnref");
	const closureRef = ctx.nextVar("closure");
	return {
		instrs: [
			Instr.Alloc({ type: "Record", fields: captured.map((a, i) => ({ label: `v${i}`, value: a.name })) }, envRef.name),
			Instr.Let(fnRef.name, E.FuncRef(fnName)),
			Instr.Alloc(
				{
					type: "Record",
					fields: [
						{ label: "__fn", value: fnRef.name },
						{ label: "__env", value: envRef.name },
					],
				},
				closureRef.name,
			),
		],
		closureRef,
	};
};
