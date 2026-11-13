import { describe, expect, it } from "vitest";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as M from "@yap/elaboration/shared/effects";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as R from "@yap/shared/rows";
import * as Eff from "@yap/utils/effects";
import * as Evaluation from "../evaluation.v2";
import * as Stack from "../machine/actions";
import { handlers } from "../machine/handlers";
import { Mode, scope, type Handling } from "../effects";
import { mkCtx, runEB, runNF } from "../../inference/__tests__/util";

const ctx = mkCtx();
const C = EB.Constructors;
const V = NF.Constructors;
const atom = (value: string) => C.Lit({ type: "Atom", value });
const bound = (index: number) => C.Var({ type: "Bound", index });
const lambda = (body: EB.Term) => C.Lambda("x", "Explicit", body, atom("Type"));
const evaluate = (term: EB.Term) => runNF(ctx, () => NF.evaluate(term));
const quote = (value: NF.Value, lvl = 0) => runNF(ctx, () => NF.quote(lvl, value));
const bubble = (identity: EB.Term, payload: EB.Term) => C.Bubble(7, NF.Type, [NF.Type], C.Suspend(identity, payload, atom("Type")));

const resume = (value: NF.Value, argument: NF.Value) => {
	const pending = match(value)
		.with({ type: "Neutral", value: { type: "Bubble", pending: P.nonNullable } }, ({ value: { pending } }) => pending)
		.otherwise(() => {
			throw new Error("Expected a Bubble with saved work");
		});
	return runNF(ctx, function* () {
		const [resumed] = yield* Eff.with([handlers<NF.Scope, EB.Term>(2000), Mode.handlers(NF.defaultMode)], () =>
			Evaluation.drive(
				(function* () {
					yield* Stack.enter(yield* scope());
					return yield* Stack.resume<NF.Value, NF.Scope, EB.Term, Handling>(pending, argument);
				})(),
				steps => `Evaluation exceeded ${steps} steps`,
			),
		);
		return resumed;
	});
};

describe("Bubble quotation", () => {
	it("retains the operation, result symbol, signature and resume candidates", () => {
		const term = bubble(atom("E"), atom("Num"));
		const value = evaluate(term);

		expect(value).toMatchObject({ type: "Neutral", kind: "Blocked", value: { type: "Bubble", meta: 7, ann: NF.Type, values: [NF.Type] } });
		expect(quote(value)).toMatchObject({
			type: "Bubble",
			meta: 7,
			ann: NF.Type,
			values: [NF.Type],
			shift: { type: "Suspend", identity: { value: { value: "E" } }, payload: { value: { value: "Num" } }, annotation: { value: { value: "Type" } } },
		});
		expect(runNF(ctx, () => NF.force(value))).toBe(value);
	});

	it("quotes an identity captured by an applied closure", () => {
		const value = evaluate(C.App("Explicit", lambda(bubble(bound(0), atom("Num"))), atom("E")));

		expect(quote(value)).toMatchObject({ type: "Bubble", shift: { type: "Suspend", identity: { type: "Lit", value: { value: "E" } } } });
	});

	it("keeps captured identities separate from a payload's own binder", () => {
		const payload = lambda(
			C.Row(
				R.Constructors.Row([
					{ label: "identity", value: bound(1) },
					{ label: "argument", value: bound(0) },
				]),
			),
		);
		const value = evaluate(C.App("Explicit", lambda(bubble(bound(0), payload)), atom("E")));

		expect(quote(value)).toMatchObject({
			shift: {
				payload: {
					type: "Abs",
					body: {
						type: "Row",
						row: {
							entries: [
								{ label: "identity", value: { type: "Lit", value: { value: "E" } } },
								{ label: "argument", value: { type: "Var", variable: { type: "Bound", index: 0 } } },
							],
						},
					},
				},
			},
		});
	});

	it("weakens a retained identity when quotation adds a binder", () => {
		const scope = EB.bind(ctx, { type: "Lambda", variable: "E" }, NF.Type);
		const value = runNF(scope, () => NF.evaluate(bubble(bound(0), atom("Num"))));

		expect(quote(value, 2)).toMatchObject({ shift: { identity: { type: "Var", variable: { type: "Bound", index: 1 } } } });
	});

	it("collects dependencies while retaining the result symbol's skolem role", () => {
		const ann = V.Flex({ type: "Meta", val: 1, lvl: 0 });
		const candidate = V.Flex({ type: "Meta", val: 2, lvl: 0 });
		const term = C.Bubble(7, ann, [candidate], C.Suspend(atom("E"), C.Var({ type: "Meta", val: 3, lvl: 0 }), atom("Type")));
		const value = evaluate(term);
		const collect = runNF(ctx, Metas.collectors);

		expect(collect.nf(value).map(meta => meta.val)).toEqual([1, 2, 3]);
		expect(new Set(collect.eb(quote(value)).map(meta => meta.val))).toEqual(new Set([1, 2, 3]));
	});

	it("retains the operation through block-return abstraction", () => {
		const value = evaluate(bubble(atom("E"), atom("Num")));
		const [abstracted] = Eff.run(() => NF.abstract(NF.Type, value, {}), [M.reader.handlers(ctx), Metas.registry.handlers({}), M.supply.handlers()]);

		expect(abstracted.term).toMatchObject({ type: "Bubble", meta: 7, shift: { type: "Suspend" } });
	});

	it("retains a suspension whose result the surrounding function ignores", () => {
		const value = evaluate(C.App("Explicit", lambda(atom("Num")), bubble(atom("E"), atom("Unit"))));
		const quoted = quote(value);

		expect(quoted).toMatchObject({
			type: "Block",
			statements: [{ type: "Let", value: { type: "Bubble", meta: 7 } }],
			return: { type: "Lit", value: { value: "Num" } },
		});
		expect(quote(value)).toMatchObject({ type: "Block", statements: [{ value: { type: "Bubble", meta: 7 } }], return: { value: { value: "Num" } } });
	});

	it("binds one suspension result used in both positions of a dependent Pi", () => {
		const value = evaluate(C.App("Explicit", lambda(C.Pi("x", "Explicit", bound(0), bound(1))), bubble(atom("E"), atom("Unit"))));

		expect(quote(value)).toMatchObject({
			type: "Block",
			statements: [{ type: "Let", value: { type: "Bubble", meta: 7 } }],
			return: { type: "Abs", binding: { type: "Pi", annotation: { variable: { index: 0 } } }, body: { variable: { index: 1 } } },
		});
	});

	it("keeps a suspension inside the lambda opened by quotation", () => {
		const value = evaluate(lambda(C.App("Explicit", lambda(atom("Num")), bubble(bound(0), atom("Unit")))));

		expect(quote(value)).toMatchObject({
			type: "Abs",
			body: {
				type: "Block",
				statements: [{ value: { type: "Bubble", shift: { identity: { variable: { index: 1 } } } } }],
				return: { value: { value: "Num" } },
			},
		});
	});

	it("retains a solved lambda's suspension while quoting inside a reset", () => {
		const meta = { type: "Meta", val: 100, lvl: 0 } as const;
		const solution = evaluate(lambda(bubble(atom("E"), atom("Unit"))));
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type, solution });
		const value = runNF(ctx, () => NF.evaluate(C.Reset(C.Var(meta))), registry);

		expect(quote(value)).toMatchObject({ type: "Abs", body: { type: "Bubble", shift: { type: "Suspend" } } });
	});

	it("weakens an outer rigid used only after the suspension", () => {
		const scope = EB.bind(ctx, { type: "Lambda", variable: "A" }, NF.Type);
		const value = runNF(scope, () => NF.evaluate(C.App("Explicit", lambda(bound(1)), bubble(atom("E"), atom("Unit")))));

		expect(quote(value, 2)).toMatchObject({ type: "Block", return: { type: "Var", variable: { type: "Bound", index: 2 } } });
	});

	it.fails("collects a meta used only after the suspension", () => {
		const meta = { type: "Meta", val: 9, lvl: 0 } as const;
		const value = evaluate(C.App("Explicit", lambda(C.Var(meta)), bubble(atom("E"), atom("Unit"))));
		const collect = runNF(ctx, Metas.collectors);

		expect(collect.nf(value)).toContainEqual(meta);
	});

	it.fails("instantiates an unconstrained type meta used only after the suspension", () => {
		const meta = { type: "Meta", val: 9, lvl: 0 } as const;
		const value = evaluate(C.App("Explicit", lambda(C.Var(meta)), bubble(atom("E"), atom("Unit"))));
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const [instantiated] = Eff.run(() => NF.instantiate(value), [M.reader.handlers(ctx), Metas.registry.handlers(registry), M.supply.handlers()]);

		expect(quote(instantiated)).toMatchObject({ type: "Block", return: { type: "Lit", value: { value: "Any" } } });
	});

	it.fails("transforms a meta used only after the suspension", () => {
		const meta = { type: "Meta", val: 9, lvl: 0 } as const;
		const value = evaluate(C.App("Explicit", lambda(C.Var(meta)), bubble(atom("E"), atom("Unit"))));
		const transformed = NF.traverse(
			value,
			() => V.Atom("String"),
			() => atom("String"),
		);

		expect(quote(transformed)).toMatchObject({ type: "Block", return: { type: "Lit", value: { value: "String" } } });
	});

	it.fails("unifies a retained Bubble with itself", () => {
		const value = evaluate(bubble(atom("E"), atom("Unit")));
		const registry = Metas.register(Metas.empty, { meta: { type: "Meta", val: 7, lvl: 0 }, annotation: NF.Type });
		const checked = runEB(
			ctx,
			function* () {
				const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.unify(value, value, 0));
				return result;
			},
			registry,
		);

		expect(Eff.failed(checked.answer)).toBe(false);
	});

	it("rejects a meta solution containing itself in a Bubble payload", () => {
		const meta = { type: "Meta", val: 9, lvl: 0 } as const;
		const registry = Metas.register(Metas.empty, { meta, annotation: NF.Type });
		const value = evaluate(bubble(atom("E"), C.Var(meta)));

		expect(() =>
			runEB(
				ctx,
				function* () {
					const [result] = yield* Eff.with([Sub.subst.handlers()], () => EB.U.bind(meta, value));
					return result;
				},
				registry,
			),
		).toThrow(/Occurs check failed/);
	});

	it.fails("keeps each replay's recursive binding in its returned closure", () => {
		const continuation = evaluate(C.Block([C.Stmt.Let("A", bubble(atom("E"), atom("Unit")), NF.Type)], lambda(bound(1))));
		const first = resume(continuation, V.Atom("Num"));
		expect(quote(first)).toMatchObject({ type: "Abs", body: { value: { value: "Num" } } });
		const second = resume(continuation, V.Atom("String"));
		expect(quote(second)).toMatchObject({ type: "Abs", body: { value: { value: "String" } } });
		expect(quote(first)).toMatchObject({ type: "Abs", body: { value: { value: "Num" } } });
	});

	it.fails("retains an unknown call whose result the surrounding function ignores", () => {
		const scope = EB.bind(ctx, { type: "Lambda", variable: "f" }, V.Pi("x", "Explicit", NF.Type, V.Closure(ctx, atom("Type"))));
		const call = C.App("Explicit", bound(0), atom("Num"));
		const value = runNF(scope, () => NF.evaluate(C.App("Explicit", lambda(atom("Num")), call)));

		expect(quote(value, 1)).toMatchObject({ type: "Block", statements: [{ type: "Let", value: { type: "App" } }], return: { value: { value: "Num" } } });
	});

	it.fails("retains the handler around an unknown callback", () => {
		const scope = EB.bind(ctx, { type: "Lambda", variable: "f" }, V.Pi("x", "Explicit", NF.Type, V.Closure(ctx, atom("Type"))));
		const term = C.Reset(C.App("Explicit", bound(0), atom("Num")), { identity: atom("E"), handler: lambda(lambda(bound(1))) });
		const value = runNF(scope, () => NF.evaluate(term));

		expect(quote(value, 1)).toMatchObject({ type: "Reset", handling: { identity: { value: { value: "E" } } } });
	});

	describe("handled callback quotation", () => {
		const number = atom("Num");
		const arrow = C.Pi("x", "Explicit", number, number);
		const handler = C.Lambda("p", "Explicit", C.Lambda("k", "Explicit", C.Lit({ type: "Num", value: 99 }), arrow), number);
		const callback = C.Lambda("x", "Explicit", C.Suspend(atom("E"), bound(0), number), number);
		const program = C.Lambda("f", "Explicit", C.Reset(C.App("Explicit", bound(0), C.Lit({ type: "Num", value: 5 })), { identity: atom("E"), handler }), arrow);
		const expected = { type: "Lit", value: { type: "Num", value: 99 } };
		it("executes the concrete callback under its handler", () => {
			expect(evaluate(C.App("Explicit", program, callback))).toMatchObject(expected);
		});

		it.fails("preserves execution after quoting the open function", () => {
			const residual = quote(evaluate(program));
			expect(evaluate(C.App("Explicit", residual, callback))).toMatchObject(expected);
		});
	});
});
