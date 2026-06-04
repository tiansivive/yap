import type * as MIR from "../lowering/mir";
import { interpretWithGlobals, type Value } from "../lowering/interpret";
import type { Runtime } from "./types";

export type { Value } from "../lowering/interpret";

export const run = (mod: MIR.Module, runtime: Runtime): Value => {
	const allFunctions = new Map([...runtime.functions, ...mod.functions.map(f => [f.name, f] as const)]);

	const augmentedMod: MIR.Module = {
		functions: [...allFunctions.values()],
		declarations: mod.declarations,
	};

	return interpretWithGlobals(augmentedMod, runtime.ffi as Record<string, (...args: unknown[]) => unknown>, runtime.globals);
};

export const emptyRuntime = (): Runtime => ({
	ffi: {},
	functions: new Map(),
	globals: new Map(),
});
