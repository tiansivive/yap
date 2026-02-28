/**
 * Shift/reset lowering. Uses Alloc + Read + Jump only (no MakeCont/Resume).
 * See docs/MIR-LOWERING.md §7.
 */

export { lowerReset, lowerInReset } from "./reset";
export { isContinuationApp, lowerContinuationApp, allocContinuation, emitResume } from "./shift";
export type { ResetCtx, ContinuationInfo } from "./types";
