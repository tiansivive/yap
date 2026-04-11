/**
 * Types for shift/reset lowering.
 * Continuation = Alloc { __env }; resume = Read + Jump.
 * See docs/MIR-LOWERING.md §7.
 *
 * Worklist-based lowering: Frame, CapturedKont. No JS closure capture.
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

/**
 * Captured continuation = IR data only. Block label + env snapshot.
 * Never a JS closure. Used for multishot resume.
 */
export type CapturedKont = {
	resumeStateId: string;
	envSnapshot: Map<number, string>;
};
