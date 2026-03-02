/**
 * Shift/reset lowering. Uses Alloc + Read + Jump only (no MakeCont/Resume).
 * See docs/MIR-LOWERING.md §7.
 */

export type { ResetCtx, ContinuationInfo } from "./types";
