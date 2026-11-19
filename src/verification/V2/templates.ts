/* Bidirectional templates open silent preconditions at function introduction and callback parameters.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/refinement-inference.md
 */
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";

import { reader, state, type Verification } from "./effects";
import { isFirstOrder } from "./utils/refinements";

export const synth = function* (term: EB.Term, type: NF.Value): Verification<{ term: EB.Term; type: NF.Value }> {
	const ctx = yield* reader.ask();
	return yield* match([term, yield* NF.view(type)])
		.with([EB.CtorPatterns.Ann, P._], function* ([annotation]) {
			const expected = yield* check(yield* NF.evaluate(annotation.ann));
			return { term: EB.Constructors.Ann(annotation.term, yield* NF.quote(ctx.env.length, expected)), type: expected };
		})
		.with([EB.CtorPatterns.Psi, NF.View.Sealed(NF.Patterns.Psi)], function* ([term, { value: type }]) {
			const precondition = yield* requirement(term.binding.requirement ? yield* NF.evaluate(term.binding.requirement) : undefined);
			const body = yield* NF.apply(type.binder, type.closure, NF.Constructors.Rigid(ctx.env.length));
			const prepared = yield* reader.local(
				c => EB.bind(c, type.binder, NF.State),
				state.local(() => NF.Constructors.Rigid(ctx.env.length), synth(term.body, body)),
			);
			return {
				term: EB.Constructors.Psi(term.binding.variable, yield* NF.quote(ctx.env.length, precondition), prepared.term),
				type: NF.Constructors.Psi(type.binder.variable, precondition, yield* NF.closeVal(prepared.type)),
			};
		})
		.with([EB.CtorPatterns.Lambda, NF.View.Sealed(NF.Patterns.Pi)], function* ([term, { value: type }]) {
			const annotation = yield* parameter(yield* NF.evaluate(term.binding.annotation), "synth");
			const body = yield* NF.apply(type.binder, type.closure, NF.Constructors.Rigid(ctx.env.length));
			const prepared = yield* reader.local(c => EB.bind(c, type.binder, annotation), synth(term.body, body));
			return {
				term: EB.Constructors.Abs({ ...term.binding, annotation: yield* NF.quote(ctx.env.length, annotation) }, prepared.term),
				type: NF.Constructors.Pi(type.binder.variable, type.binder.icit, annotation, yield* NF.closeVal(prepared.type)),
			};
		})
		.with([EB.CtorPatterns.Mu, P._], function* ([term]) {
			const prepared = yield* reader.local(c => EB.bind(c, term.binding, type), synth(term.body, type));
			return { term: EB.Constructors.Abs(term.binding, prepared.term), type: prepared.type };
		})
		.otherwise(function* () {
			return { term, type };
		});
};

export const check = (type: NF.Value): Verification<NF.Value> => contract(type, "check");

export const requirement = function* (expected: NF.Value | undefined): Verification<NF.Value> {
	if (expected) {
		return expected;
	}
	const ctx = yield* reader.ask();
	const predicate = NF.Constructors.Pi("s", "Explicit", NF.State, NF.Constructors.Closure(ctx, EB.DSL.type("Bool")));
	const meta = yield* Metas.fresh(ctx.env.length, predicate, "Predicate");
	const body = EB.Constructors.App("Explicit", EB.Constructors.Var(meta), EB.DSL.bound(0));
	return NF.Constructors.Lambda("s", "Explicit", NF.Constructors.Closure(ctx, body), NF.State);
};

export const parameter = function* (type: NF.Value, mode: "synth" | "check"): Verification<NF.Value> {
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Type), function* () {
			return type;
		})
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value }) {
			return NF.Constructors.Modal(yield* contract(value.value, "synth"), value.modalities);
		})
		.with(NF.View.Sealed(P.union(NF.Patterns.Psi, NF.Patterns.Pi, NF.Patterns.Phi)), () => contract(type, "synth"))
		.otherwise(function* () {
			if (mode === "check" || !(yield* isFirstOrder(type))) {
				return type;
			}
			const ctx = yield* reader.ask();
			const domain = yield* NF.quote(ctx.env.length + 1, type);
			const predicate = NF.Constructors.Pi(
				"s",
				"Explicit",
				NF.State,
				NF.Constructors.Closure(ctx, EB.Constructors.Pi("v", "Explicit", domain, EB.DSL.type("Bool"))),
			);
			const meta = yield* Metas.fresh(ctx.env.length, predicate, "Predicate");
			const current = yield* NF.quote(ctx.env.length + 1, yield* state.ask());
			const applied = EB.Constructors.App("Explicit", EB.Constructors.Var(meta), current);
			const body = EB.Constructors.App("Explicit", applied, EB.DSL.bound(0));
			return NF.Constructors.Modal(type, {
				quantity: Q.Many,
				liquid: NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(ctx, body), type),
			});
		});
};

const contract = function* (type: NF.Value, mode: "synth" | "check"): Verification<NF.Value> {
	const ctx = yield* reader.ask();
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Psi), function* ({ value }) {
			const precondition = mode === "synth" ? yield* requirement(value.binder.requirement) : value.binder.requirement;
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const prepared = yield* reader.local(
				c => EB.bind(c, value.binder, NF.State),
				state.local(() => NF.Constructors.Rigid(ctx.env.length), contract(body, mode)),
			);
			return NF.Constructors.Psi(value.binder.variable, precondition, yield* NF.closeVal(prepared));
		})
		.with(NF.View.Sealed(NF.Patterns.Pi), function* ({ value }) {
			const annotation = yield* parameter(value.binder.annotation, mode);
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const prepared = yield* reader.local(c => EB.bind(c, value.binder, annotation), contract(body, mode));
			return NF.Constructors.Pi(value.binder.variable, value.binder.icit, annotation, yield* NF.closeVal(prepared));
		})
		.with(NF.View.Sealed(NF.Patterns.Phi), function* ({ value }) {
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const prepared = yield* reader.local(c => EB.bind(c, value.binder, value.binder.annotation), contract(body, mode));
			return NF.Constructors.Phi(value.binder.variable, value.binder.annotation, yield* NF.closeVal(prepared));
		})
		.otherwise(function* () {
			return type;
		});
};
