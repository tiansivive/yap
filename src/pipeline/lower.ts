import * as EB from "@yap/elaboration";
import * as GRAM from "@yap/gram";
import * as E from "fp-ts/lib/Either";
import type * as Sub from "@yap/elaboration/unification/substitution";

import type { Interface } from "../modules/loading";
import type * as MIR from "../lowering/mir";
import { ARITIES } from "../lowering/shared/primops";
import type { LowerResult, CompiledModule } from "./types";

export const deriveAritiesFromInterface = (iface: Interface): Record<string, number> => ({
	...ARITIES,
	...Object.fromEntries(Object.entries(iface.declarations).map(([k, v]) => [k, v.arity])),
});

export const deriveAritiesFromContext = (ctx: EB.Context): Record<string, number> => ({
	...ARITIES,
	...Object.fromEntries(Object.entries(ctx.ffi).map(([k, v]) => [k, v.arity])),
});

export type LowerOpts = {
	zonker?: Sub.Subst;
	arities?: Record<string, number>;
	parentBinders?: ReadonlyArray<string>;
};

export const lowerTermRaw = (tm: EB.Term, opts: LowerOpts): E.Either<string, LowerResult> => {
	const gramResult = GRAM.Pipeline.compile(tm, {
		zonker: opts.zonker,
		arities: opts.arities ?? ARITIES,
		parentBinders: opts.parentBinders,
	});

	if (E.isLeft(gramResult)) {
		return E.left(`GRAM: ${JSON.stringify(gramResult.left)}`);
	}

	try {
		const mod = GRAM.Bridge.emit(gramResult.right);
		return E.right({ graph: gramResult.right, mod });
	} catch (err) {
		return E.left(`Bridge: ${err instanceof Error ? err.message : String(err)}`);
	}
};

export const lowerTerm = (tm: EB.Term, iface: Interface, opts?: { parentBinders?: ReadonlyArray<string> }): E.Either<string, LowerResult> =>
	lowerTermRaw(tm, {
		zonker: iface.zonker,
		arities: deriveAritiesFromInterface(iface),
		parentBinders: opts?.parentBinders,
	});

export const lowerTermWithContext = (tm: EB.Term, ctx: EB.Context, opts?: { parentBinders?: ReadonlyArray<string> }): E.Either<string, LowerResult> =>
	lowerTermRaw(tm, {
		zonker: ctx.zonker,
		arities: deriveAritiesFromContext(ctx),
		parentBinders: opts?.parentBinders,
	});

export const lower = (iface: Interface): E.Either<string, CompiledModule> => {
	const mir = new Map<string, MIR.Module>();

	for (const [name, result] of iface.letdecs) {
		if (E.isLeft(result)) {
			continue;
		}

		const [tm] = result.right;
		const lowered = lowerTerm(tm, iface, { parentBinders: [name] });

		if (E.isLeft(lowered)) {
			return E.left(`Error lowering ${name}: ${lowered.left}`);
		}

		mir.set(name, lowered.right.mod);
	}

	return E.right({ iface, mir });
};
