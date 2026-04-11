/**
 * Shift/reset lowering. Uses Alloc + Read + Jump only (no MakeCont/Resume).
 * See docs/MIR-LOWERING.md §7.
 *
 * Worklist-based lowering with CapturedKont (IR data, no JS closures).
 */

export type { CapturedKont, ContinuationInfo, ResetCtx } from "./types";
