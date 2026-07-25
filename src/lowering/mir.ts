import { Types } from "@yap/utils";
import { Literal } from "@yap/shared/literals";
import { Simplify } from "type-fest";

// Machine-Independent IR for Yap.
// Design plan and lowering spec: docs/MIR-LOWERING.md
//
// This is intentionally small and focused on control-flow:
// - basic blocks identified by labels
// - structured jumps (Goto / Branch)
// - assignments of simple expressions to SSA-ish variables

export type Label = string;
export type Debug = Readonly<Record<string, unknown>>;
type Node<T> = T & { debug?: Debug };

export type Function = Node<{
	name: string;
	params: string[];
	entry: Label;
	blocks: Block[];
}>;

export type Declaration = Node<{ name: string; arity: number; source: "ffi" }>;

export type Module = Node<{
	functions: Function[];
	declarations: Declaration[];
}>;

export type Block = Node<{
	label: Label;
	params: string[];
	instrs: Instr[];
	terminator: Terminator;
}>;

export type Allocation = Node<{
	type: "Record";
	fields: Array<{ label: string; value: string }>;
}>;

export type CallTarget = Node<{ type: "direct"; func: string } | { type: "indirect"; callee: string }>;

export type Instr = Node<
	| { type: "Let"; name: string; expr: Expr }
	| { type: "Read"; label: string; target: string; result: string }
	| { type: "Update"; mode: "immutable"; into: string; result: string; alloc: Allocation }
	| { type: "Update"; mode: "fbip"; into: string; updates: Array<{ label: string; value: string }> }
	| { type: "Alloc"; alloc: Allocation; result: string }
	| { type: "Call"; target: CallTarget; args: string[]; result: string }
>;

export type Case = Node<{ value: string; target: Label; args: string[] }>;
export type DefaultCase = Node<{ target: Label; args: string[] }>;

export type Terminator = Node<
	| { type: "Jump"; target: Label; args: string[] }
	| { type: "Branch"; scrutinee: string; cases: Case[]; default?: DefaultCase }
	| { type: "Return"; value: string }
>;

export type Expr = Node<
	{ type: "Var"; name: string } | { type: "Lit"; value: Literal } | { type: "FuncRef"; name: string } | { type: "PrimOp"; op: string; args: string[] }
>;

let currentId = 0;
const nextId = () => ++currentId;
export const resetId = () => {
	currentId = 0;
};

export const Constructors = {
	Expr: {
		Var: (name: string, debug?: Debug): Expr => ({ type: "Var", name, ...(debug !== undefined && { debug }) }),
		Lit: (value: Literal, debug?: Debug): Expr => ({ type: "Lit", value, ...(debug !== undefined && { debug }) }),
		FuncRef: (name: string, debug?: Debug): Expr => ({ type: "FuncRef", name, ...(debug !== undefined && { debug }) }),
		PrimOp: (op: string, args: string[], debug?: Debug): Expr => ({ type: "PrimOp", op, args, ...(debug !== undefined && { debug }) }),
	},
	Instr: {
		Let: (name: string, expr: Expr, debug?: Debug): Instr => ({ type: "Let", name, expr, ...(debug !== undefined && { debug }) }),
		Read: (label: string, target: string, result: string, debug?: Debug): Instr => ({
			type: "Read",
			label,
			target,
			result,
			...(debug !== undefined && { debug }),
		}),
		UpdateImmutable: (into: string, result: string, alloc: Allocation, debug?: Debug): Instr => ({
			type: "Update",
			mode: "immutable",
			into,
			result,
			alloc,
			...(debug !== undefined && { debug }),
		}),
		UpdateFbip: (into: string, updates: Array<{ label: string; value: string }>, debug?: Debug): Instr => ({
			type: "Update",
			mode: "fbip",
			into,
			updates,
			...(debug !== undefined && { debug }),
		}),
		Alloc: (alloc: Allocation, result: string, debug?: Debug): Instr => ({ type: "Alloc", alloc, result, ...(debug !== undefined && { debug }) }),
		Call: (target: CallTarget, args: string[], result: string, debug?: Debug): Instr => ({
			type: "Call",
			target,
			args,
			result,
			...(debug !== undefined && { debug }),
		}),
	},
	Terminator: {
		Jump: (target: Label, args: string[], debug?: Debug): Terminator => ({ type: "Jump", target, args, ...(debug !== undefined && { debug }) }),
		Branch: (scrutinee: string, cases: Case[], def?: DefaultCase, debug?: Debug): Terminator => ({
			type: "Branch",
			scrutinee,
			cases,
			...(def !== undefined && { default: def }),
			...(debug !== undefined && { debug }),
		}),
		Return: (value: string, debug?: Debug): Terminator => ({ type: "Return", value, ...(debug !== undefined && { debug }) }),
	},
	Block: (label: Label, params: string[], instrs: Instr[], terminator: Terminator, debug?: Debug): Block => ({
		label,
		params,
		instrs,
		terminator,
		...(debug !== undefined && { debug }),
	}),
	Function: (name: string, params: string[], entry: Label, blocks: Block[], debug?: Debug): Function => ({
		name,
		params,
		entry,
		blocks,
		...(debug !== undefined && { debug }),
	}),
	Module: (functions: Function[], declarations: Declaration[] = [], debug?: Debug): Module => ({
		functions,
		declarations,
		...(debug !== undefined && { debug }),
	}),
};
