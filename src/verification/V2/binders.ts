/**
 * Lambda checking and callback type formation use the same explicit Π input and binder scope.
 * See z-yap/zettels/refinement-inference.md.
 */
import { isMatching, match, P } from "ts-pattern";
import type * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import { Build } from "../solver/ivl/build";
import { check } from "./check";
import { synth } from "./synth";
import type { SynthResult } from "./types";
import { Liquid } from "../modalities";
import { reader, state, supply, type Verification } from "./effects";
import { quantify, scope } from "./logic/translate";

type FunctionBinder = Extract<NF.Binder, { type: "Pi" | "Psi" | "Phi" }>;
const Callable = NF.View.Sealed(P.union(NF.Patterns.Psi, NF.Patterns.Pi, NF.Patterns.Phi));

// A term and a closure check a body. A term alone synthesizes it. A closure alone forms a callback.
type Premise = { body: EB.Term; expected?: NF.Closure } | { body?: undefined; expected: NF.Closure };

export function* functionBinder(binder: FunctionBinder, premise: Premise): Verification<SynthResult> {
	const ctx = yield* reader.ask();
	const lvl = ctx.env.length;
	const checked = yield* match<[FunctionBinder, EB.Term | undefined], Verification<FunctionBinder>>([binder, premise.body])
		.with([{ type: "Psi", requirement: undefined }, undefined], function* ([psi]) {
			return { ...psi, requirement: yield* NF.evaluate(yield* Liquid.Predicate.hole(NF.State)) };
		})
		.with([{ type: "Pi", icit: "Explicit" }, P._], function* ([pi, body]) {
			return { ...pi, annotation: yield* domain(pi.annotation, body ? written : callbackInput) };
		})
		.otherwise(function* ([other]) {
			return other;
		});
	const annotation = match(checked)
		.with({ type: "Psi", requirement: P.nonNullable }, psi => NF.Constructors.Modal(psi.annotation, { quantity: Q.Many, liquid: psi.requirement }))
		.otherwise(other => other.annotation);
	const name = yield* supply.freshFrom(checked.variable);
	const [codomain, artefacts] = yield* scope(name, checked, annotation, body());
	const closure = NF.Constructors.Closure(ctx, yield* NF.quote(lvl + 1, codomain));
	const type = NF.mk({ type: "Abs", binder: checked, closure });

	if (premise.body && (premise.expected || checked.type === "Psi")) {
		const vc = yield* quantify(name, annotation, artefacts.vc);
		const formsType = !premise.expected && isMatching(NF.View.Sealed(NF.Patterns.Type), yield* NF.view(codomain));
		return [formsType ? NF.Type : type, { vc }];
	}
	return [type, artefacts];

	function* body(): Verification<SynthResult> {
		return yield* match(premise)
			.with({ expected: P.nonNullable }, function* ({ expected, body }): Verification<SynthResult> {
				const type = yield* NF.apply(binder, expected, NF.Constructors.Rigid(lvl));
				if (body) {
					const checked = yield* check(body, type);
					return [checked.contract ?? type, checked];
				}
				return [yield* domain(type), { vc: Build.true_() }];
			})
			.otherwise(({ body }) => synth(body));
	}
}

type DataRule = (type: NF.Value, base: NF.Value, modalities?: NF.Modalities) => Verification<NF.Value>;
const written: DataRule = function* (type) {
	return type;
};

const callbackInput: DataRule = function* (type, base, modalities) {
	if (modalities?.liquid) {
		return type;
	}
	const hole = yield* Liquid.Predicate.hole(base, yield* state.ask());
	return NF.Constructors.Modal(base, { quantity: modalities?.quantity ?? Q.Many, liquid: yield* NF.evaluate(hole) });
};

function* domain(type: NF.Value, data = written): Verification<NF.Value> {
	const viewed = yield* NF.view(type);
	const modal = match(viewed)
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => value)
		.otherwise(() => undefined);
	const base = modal?.value ?? type;
	const observed = modal ? yield* NF.view(base) : viewed;
	return yield* match(observed)
		.with(Callable, function* ({ value: fn }) {
			const [formed] = yield* functionBinder(fn.binder, { expected: fn.closure });
			const quantity = modal?.modalities.quantity ?? Q.Many;
			const liquid = yield* callablePredicate(modal?.modalities.liquid);
			return quantity === Q.Many && !liquid ? formed : NF.Constructors.Modal(formed, { quantity, liquid });
		})
		.otherwise(() => data(type, base, modal?.modalities));
}

// A predicate hole on a callable requests its input contract. Written predicates stay on the value.
function* callablePredicate(liquid?: NF.Value): Verification<NF.Value | undefined> {
	if (!liquid) {
		return undefined;
	}
	const head = yield* NF.head(liquid);
	const metas = yield* Metas.registry.get();
	return match(head)
		.with(NF.Patterns.Flex, ({ variable }) => (Metas.lookup(metas, variable.val)?.kind === "Predicate" ? undefined : liquid))
		.otherwise(() => liquid);
}

export function* subtypeOperand(type: NF.Value): Verification<NF.View> {
	const viewed = yield* NF.view(type);
	return yield* match(viewed)
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value: modal }) {
			const base = yield* NF.view(modal.value);
			return yield* match(base)
				.with(Callable, function* () {
					return (yield* callablePredicate(modal.modalities.liquid)) ? viewed : base;
				})
				.otherwise(function* () {
					return viewed;
				});
		})
		.otherwise(function* () {
			return viewed;
		});
}
