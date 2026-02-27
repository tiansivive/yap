import * as MIR from "./mir";
import type { LowerCtx, LowerResult } from "./context";

/** Build closure result: function block, alloc closure record, return instrs and value. */
export function convertClosure(
	ctx: LowerCtx,
	funcName: string,
	params: string[],
	bodyInstrs: MIR.Instr[],
	bodyResult: LowerResult,
	envAllocInstrs: MIR.Instr[],
	envRef: string,
): LowerResult {
	const block = MIR.Constructors.Block("entry", [], bodyInstrs, MIR.Constructors.Terminator.Return(bodyResult.value));
	const fn = MIR.Constructors.Function(funcName, params, "entry", [block]);
	const fnVar = ctx.nextVar("fnref");
	const closureRef = ctx.nextVar("closure");
	const instrs = [
		...envAllocInstrs,
		MIR.Constructors.Instr.Let(fnVar, MIR.Constructors.Expr.FuncRef(funcName)),
		MIR.Constructors.Instr.Alloc(
			{
				type: "Record",
				fields: [
					{ label: "__fn", value: fnVar },
					{ label: "__env", value: envRef },
				],
			},
			closureRef,
		),
	];
	return { instrs, value: closureRef, functions: [...bodyResult.functions, fn] };
}
