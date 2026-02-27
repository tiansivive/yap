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

export type Term = Types.Brand<typeof tag, Constructor & { id: number }>;
const tag: unique symbol = Symbol("MIR.Term");

type Constructor =
	| { type: "BlockGraph"; blocks: Block[]; entry: Label }
	| { type: "Lambda"; params: string[]; body: Term }
	| { type: "App"; func: Term; args: Term[] };

export type Label = string;

export type Function = {
	name: string;
	params: string[];
	entry: Label;
	blocks: Block[];
};

export type Module = {
	functions: Function[];
};

export type Block = {
	label: Label;
	params: string[];
	instrs: Instr[];
	terminator: Terminator;
};

export type Allocation = {
	type: "Record";
	fields: Array<{ label: string; value: string }>;
};

export type CallTarget = { type: "direct"; func: string } | { type: "indirect"; callee: string };

export type Instr =
	| { type: "Let"; name: string; expr: Expr }
	| { type: "Read"; label: string; target: string; result: string }
	| { type: "Update"; mode: "immutable"; into: string; result: string; alloc: Allocation }
	| { type: "Update"; mode: "fbip"; into: string; updates: Array<{ label: string; value: string }> }
	| { type: "Alloc"; alloc: Allocation; result: string }
	| { type: "Call"; target: CallTarget; args: string[]; result: string };

export type Terminator =
	| { type: "Jump"; target: Label; args: string[] }
	| { type: "Branch"; cond: string; thenTarget: Label; thenArgs: string[]; elseTarget: Label; elseArgs: string[] }
	| { type: "Return"; value: string };

export type Expr =
	| { type: "Var"; name: string }
	| { type: "Lit"; value: Literal }
	| { type: "FuncRef"; name: string }
	| { type: "PrimOp"; op: string; args: string[] };

let currentId = 0;
const nextId = () => ++currentId;
export const resetId = () => {
	currentId = 0;
};

export const mk = <K extends Constructor["type"]>(ctor: Extract<Constructor, { type: K }>) => {
	const r = Types.make(tag, { ...ctor, id: nextId() });
	return r as Simplify<typeof r>;
};

export const Constructors = {
	BlockGraph: (blocks: Block[], entry: Label): Extract<Term, { type: "BlockGraph" }> => mk({ type: "BlockGraph", blocks, entry }),
	Lambda: (params: string[], body: Term): Extract<Term, { type: "Lambda" }> => mk({ type: "Lambda", params, body }),
	App: (func: Term, args: Term[]): Extract<Term, { type: "App" }> => mk({ type: "App", func, args }),

	Expr: {
		Var: (name: string): Expr => ({ type: "Var", name }),
		Lit: (value: Literal): Expr => ({ type: "Lit", value }),
		FuncRef: (name: string): Expr => ({ type: "FuncRef", name }),
		PrimOp: (op: string, args: string[]): Expr => ({ type: "PrimOp", op, args }),
	},
	Instr: {
		Let: (name: string, expr: Expr): Instr => ({ type: "Let", name, expr }),
		Read: (label: string, target: string, result: string): Instr => ({ type: "Read", label, target, result }),
		UpdateImmutable: (into: string, result: string, alloc: Allocation): Instr => ({ type: "Update", mode: "immutable", into, result, alloc }),
		UpdateFbip: (into: string, updates: Array<{ label: string; value: string }>): Instr => ({ type: "Update", mode: "fbip", into, updates }),
		Alloc: (alloc: Allocation, result: string): Instr => ({ type: "Alloc", alloc, result }),
		Call: (target: CallTarget, args: string[], result: string): Instr => ({ type: "Call", target, args, result }),
	},
	Terminator: {
		Jump: (target: Label, args: string[]): Terminator => ({ type: "Jump", target, args }),
		Branch: (cond: string, thenTarget: Label, thenArgs: string[], elseTarget: Label, elseArgs: string[]): Terminator => ({
			type: "Branch",
			cond,
			thenTarget,
			thenArgs,
			elseTarget,
			elseArgs,
		}),
		Return: (value: string): Terminator => ({ type: "Return", value }),
	},
	Block: (label: Label, params: string[], instrs: Instr[], terminator: Terminator): Block => ({
		label,
		params,
		instrs,
		terminator,
	}),
	Function: (name: string, params: string[], entry: Label, blocks: Block[]): Function => ({
		name,
		params,
		entry,
		blocks,
	}),
	Module: (functions: Function[]): Module => ({ functions }),
};
