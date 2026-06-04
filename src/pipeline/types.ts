import type * as MIR from "../lowering/mir";
import type { Interface } from "../modules/loading";
import type { Value } from "../lowering/interpret";

export type CompiledModule = {
	iface: Interface;
	mir: Map<string, MIR.Module>;
};

export type Runtime = {
	ffi: Record<string, (...args: unknown[]) => unknown>;
	functions: Map<string, MIR.Function>;
	globals: Map<string, Value>;
};

export type LowerResult = {
	graph: import("@yap/gram").Graph;
	mod: MIR.Module;
};

export type VerificationResult = {
	success: boolean;
	errors: string[];
};
