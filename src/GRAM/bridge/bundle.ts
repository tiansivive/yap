import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Instr, Expr } = Constructors;

export type Bundle = { readonly instrs: ReadonlyArray<MIR.Instr>; readonly closureRef: string };

export const unpackEnv = (count: number, envParam: string): { vars: ReadonlyArray<string>; instrs: ReadonlyArray<MIR.Instr> } =>
	Array(count)
		.fill(0)
		.reduce<{ vars: ReadonlyArray<string>; instrs: ReadonlyArray<MIR.Instr> }>(
			(acc, _, j) => {
				const v = `cap_${j}`;
				return {
					vars: [...acc.vars, v],
					instrs: [...acc.instrs, Instr.Read(`v${j}`, envParam, v)],
				};
			},
			{ vars: [], instrs: [] },
		);

export const bundleClosure = (fnName: string, captured: ReadonlyArray<string>, prefix: string): Bundle => {
	const envRef = `env_${prefix}`;
	const fnRef = `fnref_${prefix}`;
	const closureRef = `closure_${prefix}`;

	return {
		instrs: [
			Instr.Alloc({ type: "Record", fields: captured.map((a, i) => ({ label: `v${i}`, value: a })) }, envRef),
			Instr.Let(fnRef, Expr.FuncRef(fnName)),
			Instr.Alloc(
				{
					type: "Record",
					fields: [
						{ label: "__fn", value: fnRef },
						{ label: "__env", value: envRef },
					],
				},
				closureRef,
			),
		],
		closureRef,
	};
};

export const emitAtSite = (fnName: string, captured: ReadonlyArray<string>, ctx: Ctx, bindId?: number): [string, Ctx] => {
	const [prefix, c1] = C.name(ctx, "cls");
	const bundle = bundleClosure(fnName, captured, prefix);
	const c2 = bundle.instrs.reduce((acc, i) => C.instr(acc, i), c1);
	const c3 = bindId !== undefined ? C.bind(c2, bindId, bundle.closureRef) : c2;
	return [bundle.closureRef, c3];
};
