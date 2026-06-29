import { Constructors } from "../../lowering/mir";
import type * as MIR from "../../lowering/mir";
import type { Ctx } from "./context";
import * as C from "./context";

const { Instr, Expr } = Constructors;

export type Packed = { readonly instrs: ReadonlyArray<MIR.Instr>; readonly ref: string };

export const read = (count: number, env: string): { vars: ReadonlyArray<string>; instrs: ReadonlyArray<MIR.Instr> } => {
	const pairs = Array.from({ length: count }, (_, j) => {
		const v = `cap_${j}`;
		return { v, instr: Instr.Read(`v${j}`, env, v) };
	});
	return { vars: pairs.map(p => p.v), instrs: pairs.map(p => p.instr) };
};

export const bundle = (fn: string, captured: ReadonlyArray<string>, prefix: string): Packed => {
	const env = `env_${prefix}`;
	const fnref = `fnref_${prefix}`;
	const ref = `closure_${prefix}`;
	return {
		instrs: [
			Instr.Alloc({ type: "Record", fields: captured.map((a, i) => ({ label: `v${i}`, value: a })) }, env),
			Instr.Let(fnref, Expr.FuncRef(fn)),
			Instr.Alloc(
				{
					type: "Record",
					fields: [
						{ label: "__fn", value: fnref },
						{ label: "__env", value: env },
					],
				},
				ref,
			),
		],
		ref,
	};
};

export const emit = (fn: string, captured: ReadonlyArray<string>, ctx: Ctx, id?: number): [string, Ctx] => {
	const [prefix, c1] = C.name(ctx, "cls");
	const packed = bundle(fn, captured, prefix);
	const c2 = packed.instrs.reduce((acc, i) => C.instr(acc, i), c1);
	const c3 = id !== undefined ? C.bind(c2, id, packed.ref) : c2;
	return [packed.ref, c3];
};
