import type * as EB from "@yap/elaboration";
import type { EvalMode, Evaluation } from "../effects";

export type StackFrame =
	| { type: "Eval"; env: EB.Context; mode: EvalMode; term: EB.Term }
	| { type: "Cont"; env: EB.Context; mode: EvalMode; arity: number; operands: unknown[]; k: (results: unknown[]) => Evaluation<unknown> }
	| { type: "Delimiter"; env: EB.Context }
	| { type: "Result"; operands: unknown[]; blame: Blame };

export type Runnable = Extract<StackFrame, { type: "Eval" | "Cont" }>;

export type Mark = { work: number };
export type Captured = { frames: StackFrame[]; env: EB.Context };
export type Blame = (steps: number) => string;
