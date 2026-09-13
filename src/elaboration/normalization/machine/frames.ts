/*
 * A CEK style abstract machine stack frame representation.
 *
 * S is the type of the scope (the environment E) associated with each stack frame.
 * C is the type of the control information associated with each Control frame.
 */
export type StackFrame<S, C> =
	| { type: "Control"; scope: S; control: C }
	| { type: "Cont"; scope: S; arity: number; operands: unknown[]; k: Stored }
	| { type: "Delimiter"; scope: S }
	| { type: "Result"; operands: unknown[]; blame: Blame };

export type Mark = { work: number };
export type Stored = (operands: unknown[]) => unknown;
export type Blame = (steps: number) => string;
export type Captured<S, C> = { frames: StackFrame<S, C>[]; scope: S };
export type Runnable<S, C> = Extract<StackFrame<S, C>, { type: "Control" | "Cont" }>;
