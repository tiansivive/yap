import { isMatching, match } from "ts-pattern";
import assert from "node:assert";
import * as Q from "@yap/shared/modalities/multiplicity";
import { synth } from "./synth";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import type * as EB from "@yap/elaboration";
import type { Nullable } from "@yap/utils/Nullable";
import { Liquid } from "../modalities";
import { reader, state, type Verification } from "./effects";

export function* contextual(domain: NF.Value, psiState: NF.Value): Verification<NF.Value> {
	const ctx = yield* reader.ask();
	const unary = yield* Liquid.Predicate.Kind(domain);
	const kind = NF.Constructors.Pi("s", "Explicit", NF.State, yield* NF.closeVal(unary));
	const predicate = yield* Metas.fresh(ctx.env.length, kind, "Predicate");
	return yield* NF.reduce(NF.Constructors.Flex(predicate), psiState, "Explicit");
}

export function* hole(liquid?: NF.Value): Verification<Nullable<EB.Meta>> {
	if (!liquid) {
		return undefined;
	}
	const registry = yield* Metas.registry.get();
	return match(yield* NF.view(liquid))
		.with(
			NF.View.Flex,
			({ value }) => Metas.lookup(registry, value.variable.val)?.kind === "Predicate",
			({ value }) => value.variable,
		)
		.otherwise(() => undefined);
}

export function* input(type: NF.Value): Verification<NF.Value> {
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => modalInput(value))
		.with(NF.View.Sealed(NF.Patterns.FunctionType), ({ value }) => functionInput(value))
		.otherwise(function* () {
			return type;
		});
}

function* functionInput(type: NF.Value & { type: "Abs" }): Verification<NF.Value> {
	const ctx = yield* reader.ask();
	const [, , value] = yield* synth(yield* NF.quote(ctx.env.length, type));
	assert(value);
	return value;
}

/** An inferred value parameter's predicate can depend on the enclosing application state. */
export function* modalInput(modal: NF.Value & { type: "Modal" }): Verification<NF.Value> {
	const { quantity, liquid } = modal.modalities;
	const marker = yield* hole(liquid);
	const base = yield* NF.bare(modal.value);
	return yield* match(yield* NF.view(base))
		.with(NF.View.Sealed(NF.Patterns.FunctionType), function* ({ value }) {
			const type = yield* functionInput(value);
			const predicate = marker ? undefined : liquid;
			return quantity === Q.Many && !predicate ? type : NF.Constructors.Modal(type, { quantity, liquid: predicate });
		})
		.otherwise(function* () {
			if (!marker) {
				return modal;
			}
			const current = yield* state.ask();
			const st = yield* NF.view(current);

			if (!isMatching(NF.View.Rigid, st) || st.value.variable.lvl >= marker.lvl) {
				return modal;
			}
			const predicate = yield* contextual(base, current);
			yield* Metas.registry.modify(registry => Metas.solve(registry, marker.val, predicate));
			return NF.Constructors.Modal(base, { quantity, liquid: predicate });
		});
}

/** This is the input of a callback whose function binders have already been synthesized. */
export function* inferredInput(type: NF.Value): Verification<NF.Value> {
	const base = yield* NF.bare(type);
	if (isMatching(NF.View.Sealed(NF.Patterns.FunctionType), yield* NF.view(base))) {
		return type;
	}
	const view = yield* NF.view(type);
	const modal = isMatching(NF.View.Sealed(NF.Patterns.Modal), view) ? view.value.modalities : undefined;

	if (modal?.liquid) {
		return type;
	}
	return NF.Constructors.Modal(base, { quantity: modal?.quantity ?? Q.Many, liquid: yield* contextual(base, yield* state.ask()) });
}
