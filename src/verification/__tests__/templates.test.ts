import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Eff from "@yap/utils/effects";
import * as Q from "@yap/shared/modalities/multiplicity";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF, parseExpr } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { run } from "../V2/effects";
import * as Templates from "../V2/templates";
import { Validity } from "../validity";
import * as E from "fp-ts/Either";

const C = EB.Constructors;
const D = EB.DSL;
const source = String.raw`
foreign Fetch: Effect String Num;
let fetch: (st |- key: String [| \k -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let relay = \key -> fetch key;
let declared: (key: String) -> Num = \key -> fetch key;
let withConfig: (get: (key: String) -> Num) -> Num = \get -> get "config";
`;

const predicates = (registry: Metas.Registry) => Object.values(registry).filter(entry => entry.kind === "Predicate");

describe("bidirectional refinement templates", () => {
	it.each([
		["relay", 2],
		["declared", 0],
		["withConfig", 2],
	] as const)("prepares %s from its elaborated declaration boundary", (name, count) => {
		const prepared = declaration(source, name);
		expect(predicates(prepared.registry)).toHaveLength(count);
		expect({ type: prepared.display, predicates: prepared.predicates }).toMatchSnapshot();
	});

	it("keeps the written outer state fixed and opens the callback contract", () => {
		const prepared = declaration(source, "withConfig");
		expect(prepared.core).toMatchObject({
			type: "Abs",
			binding: { type: "Psi", requirement: { type: "Abs", body: { type: "Lit", value: { type: "Bool", value: true } } } },
			body: {
				binding: {
					type: "Pi",
					annotation: { type: "Abs", binding: { type: "Psi", requirement: { type: "Abs" } }, body: { binding: { annotation: { type: "Modal" } } } },
				},
			},
		});
	});

	it("uses the same callback rule after normalizing a type alias", () => {
		const prepared = declaration(
			String.raw`
let Callback = String -> Num;
let configured: (get: Callback) -> Num = \get -> get "config";
`,
			"configured",
		);
		expect(predicates(prepared.registry)).toHaveLength(2);
	});

	it.each([
		["(apply: (get: String -> Num) -> Num) -> Num", "\\apply -> 0", 3],
		["(get: String -> Num -> Num) -> Num", "\\get -> 0", 4],
		["(get: (key: String [| \\k -> true |]) -> Num) -> Num", "\\get -> 0", 1],
	] as const)("recurses through %s", (signature, body, count) => {
		const prepared = declaration(`let configured: ${signature} = ${body};`, "configured");
		expect(predicates(prepared.registry)).toHaveLength(count);
	});

	it("reuses all expected holes when a prepared contract is checked again", () => {
		const prepared = declaration(source, "withConfig");
		const again = run(prepared.ctx, prepared.registry, () => Templates.check(prepared.type));
		const againType = again.answer;
		assert(!Eff.failed(againType));
		expect(predicates(again.registry)).toEqual(predicates(prepared.registry));
		expect(runNF(prepared.ctx, () => NF.display(againType), again.registry)).toMatchSnapshot();
	});

	it("preserves explicit true in both callback precondition positions", () => {
		const ctx = mkCtx();
		const string = D.type("String");
		const refined = C.Modal(string, { quantity: Q.Many, liquid: C.Lambda("x", "Explicit", D.bool(true), string) });
		const callback = C.Psi("s", EB.Unrestricted, C.Pi("x", "Explicit", refined, D.type("Num")));
		const type = runNF(ctx, () => NF.normalize(C.Psi("s", undefined, C.Pi("get", "Explicit", callback, D.type("Num")))));
		const prepared = run(ctx, Metas.empty, () => Templates.check(type));
		assert(!Eff.failed(prepared.answer));
		expect(predicates(prepared.registry)).toHaveLength(0);
	});

	it.each([
		String.raw`let declared = (\key -> fetch key): (key: String) -> Num;`,
		String.raw`let declared = { return ((\key -> fetch key): (key: String) -> Num); };`,
	])("preserves an expression annotation through %s", declarationSource => {
		const prepared = declaration(source.split("let relay")[0] + declarationSource, "declared");
		expect(predicates(prepared.registry)).toHaveLength(0);
		const { tm, ty, ctx, registry } = prepared.elaborated;
		const checked = VerificationServiceV2().letdec("declared", tm, ty, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(Validity.check(checked.answer.vc).tag).toBe("invalid");
	});

	it("rejects the written first-order body with its fixed requirement", () => {
		const prepared = declaration(source, "declared");
		const { tm, ty, ctx, registry } = prepared.elaborated;
		const checked = VerificationServiceV2().letdec("declared", tm, ty, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(predicates(checked.registry)).toHaveLength(0);
		expect(Validity.check(checked.answer.vc).tag).toBe("invalid");
	});

	it("preserves an existing implicit binder under an expression annotation", () => {
		const expression = parseExpr(String.raw`(\a => \x -> x): (a: Type) => a -> a`);
		const [result] = EB.Mod.expression({ type: "expression", value: expression, location: expression.location }, mkCtx());
		assert(E.isRight(result));
		expect(result.right[0]).toMatchObject({ type: "Ann", term: { binding: { type: "Lambda", icit: "Implicit" }, body: { binding: { type: "Psi" } } } });
	});

	it("verifies an arrow type declaration through the real checking entry", () => {
		const prepared = declaration("let Callback = String -> Num;", "Callback");
		const { tm, ty, ctx, registry } = prepared.elaborated;
		const checked = VerificationServiceV2().letdec("Callback", tm, ty, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(Validity.check(checked.answer.vc).tag).toBe("valid");
		expect(predicates(checked.registry)).toHaveLength(0);
	});

	it("preserves silent predicates on an inline callback checked structurally", () => {
		const passed = declaration(source + String.raw`let passed = withConfig (\key -> fetch key);`, "passed");
		const { tm, ctx, ty, registry } = passed.elaborated;
		assert(tm.type === "App");
		expect(tm.arg).toMatchObject({
			type: "Abs",
			binding: { type: "Psi", requirement: undefined },
			body: { binding: { type: "Lambda", annotation: { type: "Lit", value: { value: "String" } } } },
		});
		const within = EB.bind(ctx, { type: "Let", variable: "passed" }, ty);
		const callback = run(within, registry, function* () {
			const callbackType = yield* NF.normalize(C.Psi("s", undefined, C.Pi("key", "Explicit", D.type("String"), D.type("Num"))));
			return yield* Templates.synth(tm.arg, callbackType);
		});
		assert(!Eff.failed(callback.answer));
		expect(predicates(callback.registry)).toHaveLength(2);
	});

	it("keeps a nested written function fixed after block return normalization", () => {
		const prepared = declaration(
			source.split("let relay")[0] +
				String.raw`
let returned = { return \(u: Unit) -> ((\key -> fetch key): String -> Num); };
`,
			"returned",
		);
		const { tm, ty } = prepared.elaborated;
		assert(tm.type === "Block");
		const returned = run(prepared.ctx, prepared.registry, () => Templates.synth(tm.return, ty));
		const returnedType = returned.answer;
		assert(!Eff.failed(returnedType));
		expect(predicates(returned.registry)).toHaveLength(2);
		const core = runNF(prepared.ctx, () => NF.quote(prepared.ctx.env.length, returnedType.type), returned.registry);
		expect(core).toMatchObject({
			body: {
				body: {
					binding: { type: "Psi", requirement: { body: { value: { value: true } } } },
					body: { binding: { annotation: { type: "Modal", modalities: { liquid: { body: { value: { value: true } } } } } } },
				},
			},
		});
	});

	it("keeps generalized Type parameters fixed while inferring value preconditions", () => {
		const prepared = declaration(String.raw`let identity = \x -> x;`, "identity");
		expect(predicates(prepared.registry)).toHaveLength(2);
		expect(prepared.core).toMatchObject({ binding: { type: "Pi", icit: "Implicit", annotation: { type: "Lit", value: { value: "Type" } } } });
	});

	it("solves relay's call state to its opened outer state", () => {
		const prepared = declaration(source, "relay");
		const { tm, ty, registry } = prepared.elaborated;
		const checked = VerificationServiceV2().check(tm, ty, prepared.ctx, registry);
		assert(!Eff.failed(checked.answer));
		const call = Object.values(checked.registry).find(entry => entry.kind === "State");
		const solution = call?.solution;
		assert(solution);
		expect(runNF(prepared.ctx, () => NF.view(solution), checked.registry).value).toMatchObject({ variable: { type: "Bound", lvl: 1 } });
	});

	it("retains application result facts without adding preconditions", () => {
		const prepared = declaration(
			String.raw`
foreign produce: Num -> ((x: Num [| \v -> v > 0 |]) -> Num);
let returned = produce 1;
`,
			"returned",
		);
		expect(predicates(prepared.registry)).toHaveLength(0);
		expect(prepared.display).toMatchSnapshot();
	});
});

const declaration = (text: string, name: string) => {
	const found = elaborateModule(text).declarations.find(declaration => declaration.name === name);
	assert(found?.elaborated, found?.error);
	const { tm, ty, ctx, registry } = found.elaborated;
	const prepared = VerificationServiceV2().template(name, tm, ty, ctx, registry);
	const answer = prepared.answer;
	assert(!Eff.failed(answer));
	const within = EB.bind(ctx, { type: "Let", variable: name }, ty);
	return {
		...answer,
		registry: prepared.registry,
		ctx: within,
		elaborated: found.elaborated,
		core: runNF(within, () => NF.quote(within.env.length, answer.type), prepared.registry),
		display: runNF(within, () => NF.display(answer.type), prepared.registry),
		predicates: predicates(prepared.registry).map(entry => ({
			level: entry.meta.lvl,
			type: runNF(within, () => NF.display(entry.annotation), prepared.registry),
		})),
	};
};
