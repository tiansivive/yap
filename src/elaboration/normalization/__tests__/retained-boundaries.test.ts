import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
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

	it.each(["direct", "imported"])("retries a blocked %s call in a match after its callee meta acquires a solution", origin => {
		const base = mkCtx();
		const meta = { type: "Meta", val: 71, lvl: 0 } as const;
		const ctx: EB.Context = {
			...base,
			imports: { ...base.imports, deferred: [lambda("x", app(C.Var(meta), bound(0))), evaluate(arrow), []] },
		};
		const initial = Metas.register(Metas.empty, { meta, annotation: evaluate(arrow) });
		const callee = origin === "imported" ? C.Var(C.Vars.Free("deferred")) : C.Var(meta);
		const term = C.Match(app(callee, num(5)), [C.Alternative(C.Patterns.Lit(Lit.Num(5)), num(8), [])]);
		const held = runNF(ctx, () => NF.evaluate(term), initial);
		const solved = Metas.solve(initial, meta.val, evaluate(lambda("x", bound(0))));

		expect(runNF(ctx, () => NF.force(held), initial)).toBe(held);
		expect(runNF(ctx, () => NF.force(held), solved)).toMatchObject({ type: "Lit", value: Lit.Num(8) });
	});

	it("distinguishes producer packages with different conditional results", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const held = (answer: string) => runNF(ctx, () => NF.evaluate(C.App("Explicit", lambda("ignored", C.Lit(Lit.Atom(answer))), app(bound(0), num(5)))));
		const left = held("Num");
		const right = held("String");
		const compare = (value: NF.Value) =>
			runEB(ctx, function* () {
				const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.unify(left, value, 1));
				return result;
			});

		expect(Eff.failed(compare(right).answer)).toBe(true);
	});

	it("preserves a producer through a glued argument", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const held = runNF(ctx, () => NF.evaluate(C.App("Explicit", lambda("ignored", num(7)), app(bound(0), num(5)))));
		const reference = NF.Constructors.App(NF.Constructors.Var({ type: "Free", name: "wrap" }), ctx.env[0].nf, "Explicit");
		const glued = NF.Constructors.Glued(reference, held);
		const result = runNF(ctx, () => NF.reduce(evaluate(lambda("ignored", num(8))), glued, "Explicit"));
		expect(result).toMatchObject({ type: "Existential", producer: { type: "Neutral", kind: "Blocked" }, body: { value: { type: "Lit", value: Lit.Num(8) } } });
	});

	it.fails("unifies a producer package with itself", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const held = runNF(ctx, () => NF.evaluate(C.App("Explicit", lambda("ignored", num(7)), app(bound(0), num(5)))));
		const checked = runEB(ctx, function* () {
			const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.unify(held, held, 1));
			return result;
		});
		expect(Eff.failed(checked.answer)).toBe(false);
	});

	it.fails("weakens outer references while keeping the producer's own binder local", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const held = runNF(ctx, () => NF.evaluate(C.App("Explicit", lambda("x", bound(0)), app(bound(0), num(5)))));
		expect(runNF(ctx, () => NF.quote(2, held))).toMatchObject({ type: "Block", return: { type: "Var", variable: { index: 0 } } });
	});

	it.each([
		["blocked", "wildcard"],
		["blocked", "literal"],
		["produced", "wildcard"],
		["produced", "literal"],
	])("preserves a %s scrutinee before its %s match arm", (kind, pattern) => {
		const call = app(bound(0), num(5));
		const scrutinee = kind === "blocked" ? call : C.App("Explicit", lambda("ignored", num(7)), call);
		const arm = pattern === "wildcard" ? C.Patterns.Wildcard() : C.Patterns.Lit(Lit.Num(kind === "blocked" ? 5 : 7));
		const matching = C.Match(scrutinee, [C.Alternative(arm, app(bound(0), num(8)), [])]);
		const abort = lambda("p", C.Lambda("k", "Explicit", num(99), arrow));
		const program = C.Lambda("f", "Explicit", reset(abort, matching), arrow);
		const identity = lambda("x", bound(0));
		const residual = quote(program);

		expect(evaluate(app(program, identity))).toMatchObject({ type: "Lit", value: Lit.Num(8) });
		expect(evaluate(app(residual, identity))).toMatchObject({ type: "Lit", value: Lit.Num(8) });
		expect(evaluate(app(program, callback))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		expect(evaluate(app(residual, callback))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("rejects a meta solution containing itself in a producer binding annotation", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const meta = { type: "Meta", val: 73, lvl: 1 } as const;
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const held = runNF(ctx, () => NF.evaluate(C.App("Explicit", C.Lambda("ignored", "Explicit", num(7), C.Var(meta)), app(bound(0), num(5)))), registry);
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

	it("elaborates a function whose domain uses a symbolic type family", () => {
		const module = elaborateModule("let id: (F: Num -> Type) -> F 5 -> F 5 = \\F x -> x;");
		expect(declaration(module, "id")?.elaborated).toBeDefined();
	});

	it("collects a meta in a producer's conditional body", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const meta = { type: "Meta", val: 72, lvl: 1 } as const;
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const held = runNF(ctx, () => NF.evaluate(C.App("Explicit", lambda("ignored", C.Var(meta)), app(bound(0), num(5)))), registry);
		const collect = runNF(ctx, Metas.collectors, registry);
		const quoted = runNF(ctx, () => NF.quote(1, held), registry);

		expect(collect.eb(quoted)).toEqual([meta]);
		expect(collect.nf(held)).toEqual([meta]);
	});

	it.fails("keeps independently created producer binders distinct when their bodies combine", () => {
		const add = (left: EB.Term, right: EB.Term) => C.App("Explicit", C.App("Explicit", C.Var(C.Vars.Foreign("$add")), left), right);
		const first = app(lambda("x", bound(0)), app(bound(1), num(5)));
		const second = app(lambda("y", bound(0)), app(bound(0), num(6)));
		const sum = app(app(lambda("a", lambda("b", add(bound(1), bound(0)))), first), second);
		const program = C.Lambda("f", "Explicit", C.Lambda("g", "Explicit", sum, arrow), arrow);
		const identity = lambda("x", bound(0));
		expect(evaluate(app(app(program, identity), identity))).toMatchObject({ type: "Lit", value: Lit.Num(11) });
		expect(evaluate(app(app(quote(program), identity), identity))).toMatchObject({ type: "Lit", value: Lit.Num(11) });
	});

	it.fails("preserves a handler around a blocked record field", () => {
		const structure = (value: EB.Term) => C.Struct(R.Constructors.Row([{ label: "x", value }]));
		const shape = C.Schema(R.Constructors.Row([{ label: "x", value: number }]));
		const continuation = C.Pi("x", "Explicit", number, shape);
		const abort = lambda("p", C.Lambda("k", "Explicit", structure(num(99)), continuation));
		const handled = C.Ann(C.Reset(structure(app(bound(0), num(5))), { identity: E, handler: abort }), shape);
		const program = C.Lambda("f", "Explicit", handled, arrow);
		const expected = { type: "App", arg: { type: "Row", row: { entries: [{ label: "x", value: { type: "Lit", value: Lit.Num(99) } }] } } };

		expect(evaluate(app(program, callback))).toMatchObject(expected);
		expect(evaluate(app(quote(program), callback))).toMatchObject(expected);
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

	it.fails("preserves a discarded statement call before a later suspension", () => {
		const body = C.Block([C.Stmt.Expr(app(bound(0), num(5)))], C.Suspend(E, num(8), number));
		const abort = lambda("p", C.Lambda("k", "Explicit", bound(1), arrow));
		const program = C.Lambda("f", "Explicit", reset(abort, body), arrow);
		expect(evaluate(app(program, callback))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
		expect(evaluate(app(quote(program), callback))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
	});
});
