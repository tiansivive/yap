import assert from "node:assert";
import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Eff from "@yap/utils/effects";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { run, state } from "../V2/effects";
import { scope, term } from "../V2/logic/translate";
import { Build } from "../solver/ivl/build";
import { Validity } from "../validity";

const C = EB.Constructors;
const D = EB.DSL;
const bool = (value: boolean) => C.Lit({ type: "Bool", value });
const requirement = (value: boolean) => C.Lambda("s", "Explicit", bool(value), EB.State);
const num = D.type("Num");
const refined = (value: boolean) => C.Modal(num, { quantity: Q.Many, liquid: C.Lambda("x", "Explicit", bool(value), num) });
const meta = EB.Meta(0, 0);
const registered = (kind: Metas.Kind = "State", variable = meta) => Metas.register(Metas.empty, { kind, meta: variable, annotation: NF.State });
const normalize = (core: EB.Term, ctx = mkCtx()) => runNF(ctx, () => NF.normalize(core));

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("Psi verification", () => {
	it.each([
		[false, "valid"],
		[true, "invalid"],
	] as const)("assumes the state binder requirement %s around the body", (precondition, expected) => {
		const type = normalize(C.Psi("s", requirement(precondition), C.Pi("x", "Explicit", num, refined(false))));
		const core = C.Psi("s", requirement(precondition), C.Lambda("x", "Explicit", D.num(1), num));
		const { answer } = VerificationServiceV2().check(core, type, mkCtx(), Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe(expected);
	});

	it.each([
		[true, "valid"],
		[false, "invalid"],
	] as const)("checks a state application requirement %s", (precondition, expected) => {
		const ctx = imported(C.Psi("s", requirement(precondition), C.Pi("x", "Explicit", num, num)));
		const core = C.App("Psi", C.Var(C.Vars.Foreign("f")), C.Var(meta));
		const { answer, registry } = VerificationServiceV2().synth(core, ctx, registered());
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe(expected);
		expect(registry[meta.val].solution).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "$state.empty" } });
		expect(registered()[meta.val].solution).toBeUndefined();
	});

	it.each([
		[0, "valid"],
		[1, "invalid"],
	] as const)("checks a state-dependent requirement with caller state %s", (level, expected) => {
		const outer = EB.bind(mkCtx(), { type: "Pi", variable: "expected" }, NF.State);
		const base = EB.bind(outer, { type: "Pi", variable: "other" }, NF.State);
		const predicate = C.Lambda("s", "Explicit", D.eq(D.bound(0), D.bound(2)), EB.State);
		const annotation = normalize(C.Psi("s", predicate, C.Pi("x", "Explicit", num, num)), base);
		const ctx: EB.Context = { ...base, imports: { ...base.imports, f: [C.Var(C.Vars.Foreign("f")), annotation, []] } };
		const current = NF.Constructors.Rigid(level);
		const argument = EB.Meta(0, ctx.env.length);
		const core = C.App("Psi", C.Var(C.Vars.Foreign("f")), C.Var(argument));
		const { answer, registry } = VerificationServiceV2({ state: current }).synth(core, ctx, registered("State", argument));
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe(expected);
		expect(registry[meta.val].solution).toBe(current);
		const readback = runNF(
			ctx,
			function* () {
				const solution = Metas.solution(registry, meta.val);
				assert(solution);
				const quoted = yield* NF.quote(ctx.env.length, solution);
				return yield* NF.view(yield* NF.evaluate(quoted));
			},
			registry,
		);
		expect(readback.value).toMatchObject({ type: "Var", variable: { type: "Bound", lvl: level } });
	});

	it.each(["Elaboration", "Predicate"] as const)("preserves %s meta ownership at state application", kind => {
		const ctx = imported(C.Psi("s", EB.Unrestricted, C.Pi("x", "Explicit", num, num)));
		const core = C.App("Psi", C.Var(C.Vars.Foreign("f")), C.Var(meta));
		expect(() => VerificationServiceV2().synth(core, ctx, registered(kind))).toThrow("State applications solve state metas");
	});

	it("scopes the current state through Psi and restores it after nested binders", () => {
		const { answer } = run(mkCtx(), Metas.empty, function* () {
			const initial = yield* state.ask();
			const scoped = yield* scope(
				"outer",
				{ type: "Psi", variable: "outer" },
				NF.State,
				(function* () {
					const outer = yield* state.ask();
					const inner = yield* scope("inner", { type: "Psi", variable: "inner" }, NF.State, state.ask());
					const restored = yield* state.ask();
					return { outer, inner, restored };
				})(),
			);
			const restored = yield* state.ask();
			return { initial, scoped, restored };
		});
		assert(!Eff.failed(answer));
		expect(runNF(mkCtx(), () => NF.view(answer.scoped.outer)).value).toMatchObject({ variable: { type: "Bound", lvl: 0 } });
		expect(runNF(mkCtx(), () => NF.view(answer.scoped.inner)).value).toMatchObject({ variable: { type: "Bound", lvl: 1 } });
		expect(answer.scoped.restored).toBe(answer.scoped.outer);
		expect(answer.restored).toBe(answer.initial);
	});

	it("translates the initial state using its ordinary State annotation", () => {
		const { answer } = run(mkCtx(), Metas.empty, function* () {
			const current = yield* state.ask();
			return yield* term(current);
		});
		assert(!Eff.failed(answer));
		expect(answer).toEqual(Build.const_("$state.empty", Build.uninterpreted("State")));
	});

	it("compares state and value requirements at their own application stages", () => {
		const stateRequired = normalize(C.Psi("s", requirement(false), C.Pi("x", "Explicit", num, num)));
		const valueRequired = normalize(C.Psi("s", requirement(true), C.Pi("x", "Explicit", refined(false), num)));
		const service = VerificationServiceV2();
		const forward = service.subtype(stateRequired, valueRequired, mkCtx(), Metas.empty);
		const reverse = service.subtype(valueRequired, stateRequired, mkCtx(), Metas.empty);
		assert(!Eff.failed(forward.answer) && !Eff.failed(reverse.answer));
		expect(Validity.check(forward.answer).tag).toBe("invalid");
		expect(Validity.check(reverse.answer).tag).toBe("valid");
	});

	it("verifies a positive identity with a retained parameter predicate", () => {
		expect(Validity.check(written("x")).tag).toBe("valid");
	});

	it("rejects a zero result under a positive written result contract", () => {
		expect(Validity.check(written("0")).tag).toBe("invalid");
	});

	it.each([
		[1, "valid"],
		[0, "invalid"],
	] as const)("checks an ordinary call with argument %s", (argument, expected) => {
		const [, { name, elaborated, error }] = elaborateModule(String.raw`
let positive: (x: Num [| \v -> v > 0 |]) -> Num = \x -> x;
let result = positive ${argument};
`).declarations;
		assert(elaborated, error);
		const { tm, ty, ctx, registry } = elaborated;
		const { answer, registry: verified } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe(expected);
		expect(
			Object.values(verified)
				.filter(entry => entry.kind === "State")
				.every(entry => entry.solution !== undefined),
		).toBe(true);
	});
});

const imported = (type: EB.Term): EB.Context => {
	const ctx = mkCtx();
	const annotation = normalize(type, ctx);
	return { ...ctx, imports: { ...ctx.imports, f: [C.Var(C.Vars.Foreign("f")), annotation, []] } };
};

const written = (body: string) => {
	const [{ name, elaborated, error }] = elaborateModule(
		String.raw`let positive: (x: Num [| \v -> v > 0 |]) -> Num [| \v -> v > 0 |] = \x -> ${body};`,
	).declarations;
	assert(elaborated, error);
	const { tm, ty, ctx, registry } = elaborated;
	const { answer } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
	assert(!Eff.failed(answer));
	return answer.vc;
};
