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
import { reader, run, state, State } from "../V2/effects";
import { live, scope, term } from "../V2/logic/translate";
import { selfify } from "../V2/utils/refinements";
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
		["x", "valid"],
		["0", "invalid"],
	] as const)("applies the state and input predicates to their binders when returning %s", (body, expected) => {
		const predicate = (domain: EB.Term) => normalize(C.Pi("v", "Explicit", domain, D.type("Bool")));
		const outer = EB.bind(mkCtx(), { type: "Pi", variable: "q" }, predicate(EB.State));
		const ctx = EB.bind(outer, { type: "Pi", variable: "p" }, predicate(num));
		const stateRequirement = D.bound(1);
		const refinedBy = (index: number) => C.Modal(num, { quantity: Q.Many, liquid: D.bound(index) });
		const type = normalize(C.Psi("s", stateRequirement, C.Pi("x", "Explicit", refinedBy(1), refinedBy(2))), ctx);
		const core = C.Psi("s", stateRequirement, C.Lambda("x", "Explicit", body === "x" ? D.bound(0) : D.num(0), refinedBy(1)));
		const { answer } = VerificationServiceV2().check(core, type, ctx, Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe(expected);
	});

	it("preserves an open input predicate when selfifying a value", () => {
		const ctx = mkCtx();
		const registry = Metas.register(Metas.empty, { kind: "Predicate", meta, annotation: normalize(C.Pi("v", "Explicit", num, D.type("Bool"))) });
		const { answer, registry: verified } = run(ctx, registry, function* () {
			const domain = yield* NF.evaluate(C.Modal(num, { quantity: Q.Many, liquid: C.Var(meta) }));
			const refined = yield* selfify(D.num(3), domain);
			assert(refined.type === "Modal");
			const applied = yield* NF.reduce(refined.modalities.liquid, yield* NF.evaluate(D.num(7)), "Explicit");
			return yield* NF.quote(ctx.env.length, applied);
		});
		expect(answer).toMatchObject({
			statements: [{ value: { type: "App", icit: "Explicit", func: { variable: meta }, arg: { value: { type: "Num", value: 7 } } } }],
		});
		expect(Metas.solution(verified, meta.val)).toBeUndefined();
	});

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
		expect(registry[meta.val].solution).toMatchObject({ type: "Neutral", kind: "Sealed", value: { type: "External", name: "$empty", args: [] } });
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
		expect(answer).toEqual(Build.const_("$empty", Build.uninterpreted("State")));
	});

	it("preserves carrier typing and nested state membership through quotation", () => {
		const carrier = normalize(D.app(D.app(D.type("Effect"), D.type("Unit")), num));
		const ambient = EB.bind(mkCtx(), { type: "Pi", variable: "s" }, NF.State);
		const first = EB.bind(ambient, { type: "Pi", variable: "Ask" }, carrier);
		const ctx = EB.bind(first, { type: "Pi", variable: "Tell" }, carrier);
		const { answer } = run(
			ctx,
			Metas.empty,
			function* () {
				const current = yield* state.ask();
				const ask = NF.Constructors.Rigid(1);
				const tell = NF.Constructors.Rigid(2);
				const inserted = yield* State.insert(current, ask, carrier);
				const nested = yield* State.insert(inserted, tell, carrier);
				const quoted = yield* NF.quote(ctx.env.length, nested);
				const restored = yield* NF.evaluate(quoted);
				const context = yield* reader.ask();
				const [, signature] = context.imports[State.heads.insert];
				assert(signature.type === "Abs" && signature.binder.type === "Pi" && signature.binder.icit === "Explicit");
				const stateParameter = yield* NF.apply(signature.binder, signature.closure, carrier);
				assert(stateParameter.type === "Abs");
				const identityParameter = yield* NF.apply(stateParameter.binder, stateParameter.closure, current);
				assert(identityParameter.type === "Abs");
				return {
					carrier: identityParameter.binder.annotation,
					result: yield* NF.apply(identityParameter.binder, identityParameter.closure, ask),
					quoted: yield* NF.quote(ctx.env.length, inserted),
					before: yield* term(nested),
					after: yield* term(restored),
					membership: yield* live(restored, ask),
					current: yield* term(current),
					ask: yield* term(ask),
					tell: yield* term(tell),
				};
			},
			{ state: NF.Constructors.Rigid(0) },
		);
		assert(!Eff.failed(answer));
		expect(answer.carrier).toBe(carrier);
		expect(answer.result).toMatchObject({ type: "Lit", value: { type: "Atom", value: "State" } });
		expect(answer.quoted).toMatchObject({
			type: "App",
			icit: "Explicit",
			func: { type: "App", icit: "Explicit", func: { type: "App", icit: "Explicit", func: { type: "Var", variable: { name: "$insert" } } } },
		});
		const sort = Build.uninterpreted("State");
		expect(answer.before).toEqual(Build.app("$insert", [Build.app("$insert", [answer.current, answer.ask], sort), answer.tell], sort));
		expect(answer.after).toEqual(answer.before);
		expect(answer.membership).toEqual(
			Build.or(
				Build.atom("=", answer.tell, answer.ask),
				Build.atom("=", answer.ask, answer.ask),
				Build.atom("=", Build.app("$state.live", [answer.current, answer.ask], Build.Bool), Build.bool(true)),
			),
		);
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
