import { Types } from "@yap/utils";
import { Literal } from "@yap/shared/literals";
import { Simplify } from "type-fest";

// Lowered IR syntax for Yap.
//
// This is intentionally small and focused on control-flow:
// - basic blocks identified by labels
// - structured jumps (Goto / Branch)
// - assignments of simple expressions to SSA-ish variables

export type Term = Types.Brand<typeof tag, Constructor & { id: number }>;
const tag: unique symbol = Symbol("LIR.Term");

type Constructor =
	| { type: "BlockGraph"; blocks: Block[]; entry: Label }
	| { type: "Lambda"; params: string[]; body: Term }
	| { type: "App"; func: Term; args: Term[] };

export type Label = string;

export type Block = {
	label: Label;
	instrs: Instr[];
};

export type Instr =
	| { type: "Assign"; target: string; expr: Expr }
	| { type: "Branch"; cond: string; thenLabel: Label; elseLabel: Label }
	| { type: "Jump"; label: Label; value: string };

export type Expr = { type: "Var"; name: string } | { type: "Lit"; value: Literal } | { type: "PrimOp"; op: string; args: string[] };

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
};
