import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Lit from "@yap/shared/literals";
import * as Eff from "@yap/utils/effects";
import * as Evaluation from "../evaluation.v2";
import * as NbE from "../nbe";
import { handlers } from "../machine/handlers";
import { Mode, defaultMode, type Handling } from "../effects";
import { declaration, elaborateModule } from "../../__tests__/module";
import { mkCtx, runEB, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const fuel = 2000;
const number = C.Lit(Lit.Atom("Num"));
const E = C.Lit(Lit.Atom("E"));
const num = (value: number) => C.Lit(Lit.Num(value));
const bound = (index: number) => C.Var(EB.Bound(index));
const app = (func: EB.Term, arg: EB.Term) => C.Ann(C.App("Explicit", func, arg), number);
const lambda = (name: string, body: EB.Term) => C.Lambda(name, "Explicit", body, number);
const arrow = C.Pi("x", "Explicit", number, number);
const reset = (handler: EB.Term, body: EB.Term) => C.Ann(C.Reset(body, { identity: E, handler }), number);
const callback = lambda("x", C.Suspend(E, bound(0), number));
const resume = lambda("p", C.Lambda("k", "Explicit", app(bound(0), bound(1)), arrow));
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.evaluate(term));
const quote = (term: EB.Term) => runNF(mkCtx(), () => NF.quote(0, evaluate(term)));

const generated = () => {
	const module = elaborateModule(`
		foreign E: Effect Num Num;
		let callback: Num -> Num = \\x -> suspend @E x;
		let result: (Num -> Num) -> Num = \\f -> with E: (\\p k -> k (p + 1)) in f 5;
	`);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	const program = declaration(module, "result")?.elaborated;
	const argument = declaration(module, "callback")?.elaborated;
	if (!program || !argument) {
		throw new Error("Expected the program and callback declarations");
	}
	return { program, argument };
};

describe("retained handler boundaries", () => {
	it("preserves saved work when the callee meta acquires a solution", () => {
		const ctx = mkCtx();
		const meta = { type: "Meta", val: 71, lvl: 0 } as const;
		const initial = Metas.register(Metas.empty, { meta, annotation: evaluate(arrow) });
		const term = C.App("Explicit", lambda("ignored", num(7)), app(C.Var(meta), num(5)));
		const held = runNF(ctx, () => NF.evaluate(term), initial);
		const solved = Metas.solve(initial, meta.val, evaluate(lambda("x", bound(0))));
		const forced = runNF(ctx, () => NF.force(held), solved);

		expect(forced).toBe(held);
		expect(
			runNF(
				ctx,
				function* () {
					return yield* NF.evaluate(yield* NF.quote(0, forced));
				},
				solved,
			),
		).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});

	it("distinguishes retained calls with different pending results", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const held = (answer: string) => runNF(ctx, () => NF.evaluate(C.Block([C.Stmt.Expr(app(bound(0), num(5)))], C.Lit(Lit.Atom(answer)))));
		const left = held("Num");
		const right = held("String");
		const compare = (value: NF.Value) =>
			runEB(ctx, function* () {
				const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.unify(left, value, 1));
				return result;
			});

		expect(Eff.failed(compare(right).answer)).toBe(true);
		expect(Eff.failed(compare(left).answer)).toBe(false);
	});

	it("rejects a meta solution containing itself in a retained call annotation", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const meta = { type: "Meta", val: 73, lvl: 1 } as const;
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const held = runNF(ctx, () => NF.evaluate(C.Ann(C.App("Explicit", bound(0), num(5)), C.Var(meta))), registry);
		const collect = runNF(ctx, Metas.collectors, registry);

		expect(collect.nf(held)).toEqual([meta]);
		expect(() =>
			runEB(
				ctx,
				function* () {
					const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.bind(meta, held));
					return result;
				},
				registry,
			),
		).toThrow(/Occurs check failed/);
	});

	it.fails("elaborates a function whose domain uses a symbolic type family", () => {
		const module = elaborateModule("let id: (F: Num -> Type) -> F 5 -> F 5 = \\F x -> x;");
		expect(declaration(module, "id")?.elaborated).toBeDefined();
	});

	it.fails("collects a meta used only after a retained application", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const meta = { type: "Meta", val: 72, lvl: 1 } as const;
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const held = runNF(ctx, () => NF.evaluate(C.Block([C.Stmt.Expr(app(bound(0), num(5)))], C.Var(meta))), registry);
		const collect = runNF(ctx, Metas.collectors, registry);
		const quoted = runNF(ctx, () => NF.quote(1, held), registry);

		expect(collect.eb(quoted)).toEqual([meta]);
		expect(collect.nf(held)).toEqual([meta]);
	});

	it("quotes a resuming handler around a tail call", () => {
		const program = C.Lambda("f", "Explicit", reset(resume, app(bound(0), num(5))), arrow);
		expect(evaluate(app(program, callback))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
		expect(evaluate(app(quote(program), callback))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
	});

	it("retains the anonymous identity's signature through quotation", () => {
		const module = elaborateModule("let result: (Num -> Num) -> Num = \\f -> reset (f 5);");
		expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
		const program = declaration(module, "result")?.elaborated;
		if (!program) {
			throw new Error("Expected the result declaration");
		}
		const residual = runNF(program.ctx, () => NF.quote(0, evaluate(program.tm)), program.registry);
		const anonymous = lambda("x", C.Suspend(EB.Anonymous, C.Lambda("k", "Explicit", app(bound(0), num(7)), arrow), number));
		expect(residual).toMatchObject({
			type: "Abs",
			body: { type: "Ann", term: { type: "Reset", handling: { identity: { type: "Ann", term: { value: { value: "$anonymous" } } } } } },
		});
		expect(runNF(program.ctx, () => NF.evaluate(app(residual, anonymous)), program.registry)).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});

	it("executes a generated resuming handler before quotation", () => {
		const { program, argument } = generated();
		expect(runNF(program.ctx, () => NF.evaluate(app(program.tm, argument.tm)), program.registry)).toMatchObject({ type: "Lit", value: Lit.Num(6) });
	});

	it.fails("quotes the recursive binding in a generated resuming handler", () => {
		const { program, argument } = generated();
		const residual = runNF(
			program.ctx,
			function* () {
				const value = yield* NF.evaluate(program.tm);
				const [quoted] = yield* Eff.with([handlers<NF.Scope, EB.Term, Handling>(fuel), Mode.handlers(defaultMode)], () =>
					Evaluation.drive(NbE.quote(0, value), steps => `Quotation exceeded ${steps} steps`),
				);
				return quoted;
			},
			program.registry,
		);
		expect(runNF(program.ctx, () => NF.evaluate(app(residual, argument.tm)), program.registry)).toMatchObject({ type: "Lit", value: Lit.Num(6) });
	});

	it("executes a concrete suspension following a known call", () => {
		const body = C.Block([C.Stmt.Expr(app(bound(0), num(5)))], C.Suspend(E, num(8), number));
		const program = C.Lambda("f", "Explicit", reset(resume, body), arrow);
		expect(evaluate(app(program, lambda("x", bound(0))))).toMatchObject({ type: "Lit", value: Lit.Num(8) });
	});

	it.fails("retains a concrete suspension following an unknown call", () => {
		const body = C.Block([C.Stmt.Expr(app(bound(0), num(5)))], C.Suspend(E, num(8), number));
		const program = C.Lambda("f", "Explicit", reset(resume, body), arrow);
		expect(evaluate(app(quote(program), lambda("x", bound(0))))).toMatchObject({ type: "Lit", value: Lit.Num(8) });
	});
});
