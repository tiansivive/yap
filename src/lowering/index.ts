/**
 * @deprecated Use GRAM.Bridge.emit for EB → MIR lowering.
 * This module is the legacy direct lowering path (EB → MIR).
 * It is retained for reference and existing tests but should not be extended.
 * New lowering work goes in src/GRAM/bridge/.
 */
export * from "./mir";
export * from "./pretty";
export * from "./lower";
export * from "./interpret";
export * from "./context";
export * from "./functions/closures";
export * from "./shared/freevars";
