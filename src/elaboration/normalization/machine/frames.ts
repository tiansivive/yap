/*
 * A CEK style abstract machine stack frame representation.
 *
 * S is the type of the scope (the environment E) associated with each stack frame.
 * C is the type of the control information associated with each Control frame.
 * D is the language-specific data stored on a delimiter.
 */
export type StackFrame<S, C, D = unknown> =
	| { type: "Control"; scope: S; control: C }
	| { type: "Cont"; scope: S; arity: number; operands: unknown[]; k: Stored }
	| { type: "Delimiter"; scope: S; handling?: D }
	| { type: "Result"; operands: unknown[]; blame: Blame };

/*
 * A value the machine holds rather than one you have. Phantom: nothing is stored, so a single
 * instance stands for every one of them. It exists to carry the type past a scheduling call, and
 * it is where a hook would attach if the machine ever gains one.
 */
export type Machine<A> = { readonly [held]?: A };
declare const held: unique symbol;
export const scheduled: Machine<never> = {};

export type Mark = { work: number };
export type Stored = (operands: unknown[]) => unknown;
export type Blame = (steps: number) => string;
export type Captured<S, C, D = unknown> = { frames: StackFrame<S, C, D>[]; scope: S };
export type Runnable<S, C, D = unknown> = Extract<StackFrame<S, C, D>, { type: "Control" | "Cont" }>;
