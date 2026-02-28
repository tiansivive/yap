/**
 * Types for shift/reset lowering.
 * Continuation = Alloc { __env }; resume = Read + Jump.
 * See docs/MIR-LOWERING.md §7.
 */

/** Info for a continuation: block to jump to on resume. */
export type ContinuationInfo = {
	blockLabel: string;
};

/**
 * Context when lowering inside a reset.
 * Maps de Bruijn index (of continuation binder) → ContinuationInfo.
 */
export type ResetCtx = {
	resetExit: string;
	/** Index of continuation binder in env → block label for resume. */
	continuations: Map<number, ContinuationInfo>;
};
