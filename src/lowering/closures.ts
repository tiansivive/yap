import * as MIR from "./mir";
import * as M from "./monad";
import type * as C from "./context";

export function* convertClosure(
	ctx: C.LowerCtx,
	fnName: string,
	params: string[],
	body: {
		instrs: MIR.Instr[];
		result: M.LowerResult;
	},
	env: {
		allocInstrs: MIR.Instr[];
		ref: C.Stamped;
	},
): M.Glowering<C.Stamped> {
	const block = MIR.Constructors.Block(`${fnName}_entry`, [], body.instrs, MIR.Constructors.Terminator.Return(body.result.value.name));
	const fn = MIR.Constructors.Function(fnName, params, block.label, [block]);

	const fnVar = ctx.nextVar("fnref");
	const closureRef = ctx.nextVar("closure");

	const instrs = [
		...env.allocInstrs,
		MIR.Constructors.Instr.Let(fnVar.name, MIR.Constructors.Expr.FuncRef(fnName)),
		MIR.Constructors.Instr.Alloc(
			{
				type: "Record",
				fields: [
					{ label: "__fn", value: fnVar.name },
					{ label: "__env", value: env.ref.name },
				],
			},
			closureRef.name,
		),
	];

	yield* M.Functions.emit(fn);
	yield* M.Pending.appendMany(instrs);

	return closureRef;
}
