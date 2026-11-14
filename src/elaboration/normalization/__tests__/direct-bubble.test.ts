import { beforeEach, describe, expect, it } from "vitest";
import assert from "node:assert";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { mkCtx, parseExpr, runEB, runNF, shown } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const atom = (value: string) => C.Lit({ type: "Atom", value });
const bound = (index: number) => C.Var(EB.Bound(index));
const unit = () => C.Lit({ type: "unit" });
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.evaluate(term));
const quote = (value: NF.Value) => runNF(mkCtx(), () => NF.quote(0, value));

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("direct Bubble representation", () => {
	it("elaborates a named operation with a typed result symbol", () => {
		const effect = V.App(V.App(V.Atom("Effect"), V.Atom("Unit"), "Explicit"), V.Atom("Num"), "Explicit");
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "Ask" }, effect);
		const { answer, registry } = runEB(ctx, () => EB.infer(parseExpr("suspend @Ask !")));
		assert(!Eff.failed(answer), "Expected an elaborated operation");
		const [term] = answer;
		assert(term.type === "Bubble", "Expected a Bubble result symbol");

		expect(term).toMatchObject({
			type: "Bubble",
			identity: { type: "Var", variable: { type: "Bound", index: 0 } },
			payload: { type: "Lit", value: { type: "unit" } },
			ann: { type: "Lit", value: { type: "Atom", value: "Num" } },
		});
		expect(registry[term.meta].annotation).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Num" } });
	});

	it("elaborates an anonymous suspension as a Bubble", () => {
		const { answer } = runEB(mkCtx(), () => EB.infer(parseExpr("suspend (\\k -> k 7)")));
		assert(!Eff.failed(answer), "Expected an elaborated anonymous operation");

		expect(answer[0]).toMatchObject({
			type: "Bubble",
			meta: expect.any(Number),
			identity: { type: "Ann", term: { type: "Lit", value: { type: "Atom", value: "$anonymous" } } },
			payload: { type: "Abs", binding: { type: "Lambda" } },
			ann: { type: "Var", variable: { type: "Meta" } },
		});
	});

	it("evaluates and quotes the operation, result symbol and type", () => {
		const term = C.Bubble(7, atom("Type"), [], atom("E"), atom("Num"));
		const value = evaluate(term);

		expect(value).toMatchObject({
			type: "Neutral",
			kind: "Blocked",
			value: {
				type: "Bubble",
				meta: 7,
				ann: { type: "Lit", value: { type: "Atom", value: "Type" } },
				identity: { type: "Lit", value: { type: "Atom", value: "E" } },
				payload: { type: "Lit", value: { type: "Atom", value: "Num" } },
			},
		});
		expect(quote(value)).toMatchObject({
			type: "Bubble",
			meta: 7,
			ann: { type: "Lit", value: { type: "Atom", value: "Type" } },
			identity: { type: "Lit", value: { type: "Atom", value: "E" } },
			payload: { type: "Lit", value: { type: "Atom", value: "Num" } },
		});
	});

	it("evaluates a result type in its source binder scope", () => {
		const operation = C.Bubble(7, bound(0), [], atom("E"), unit());
		const term = C.App("Explicit", C.Lambda("A", "Explicit", operation, atom("Type")), atom("Num"));

		expect(quote(evaluate(term))).toMatchObject({ type: "Bubble", ann: { type: "Lit", value: { type: "Atom", value: "Num" } } });
	});

	it("quotes a dependent result type under its binder", () => {
		const term = C.Lambda("A", "Explicit", C.Bubble(7, bound(0), [], atom("E"), unit()), atom("Type"));

		expect(quote(evaluate(term))).toMatchObject({
			type: "Abs",
			body: { type: "Bubble", ann: { type: "Var", variable: { type: "Bound", index: 0 } } },
		});
	});

	it("passes a concrete operation to its matching handler", () => {
		const number = atom("Num");
		const handler = C.Lambda("p", "Explicit", C.Lambda("k", "Explicit", C.App("Explicit", bound(0), bound(1)), C.Pi("x", "Explicit", number, number)), number);
		const operation = C.Bubble(7, number, [], atom("E"), C.Lit({ type: "Num", value: 9 }));

		expect(evaluate(C.Reset(operation, { identity: atom("E"), handler }))).toMatchObject({ type: "Lit", value: { type: "Num", value: 9 } });
	});

	it("displays the operation in Core and NF", () => {
		const term = C.Bubble(7, atom("Num"), [], atom("E"), unit());
		const value = evaluate(term);
		const display = shown(mkCtx(), {});

		expect({ core: display(() => EB.Display.Term(term)), nf: display(() => NF.display(value)) }).toMatchInlineSnapshot(`
			{
			  "core": "bubble#7 (suspend @E unit)",
			  "nf": "bubble#7 (suspend @E unit)",
			}
		`);
	});
});
