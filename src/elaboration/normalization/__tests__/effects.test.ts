import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const atom = (name: string) => C.Lit(Lit.Atom(name));
const num = (value: number) => C.Lit(Lit.Num(value));
const v = (index: number) => C.Var(EB.Bound(index));
const lambda = (name: string, body: EB.Term) => C.Lambda(name, "Explicit", body, EB.Any);
const app = (f: EB.Term, x: EB.Term) => C.App("Explicit", f, x);
const add = (a: EB.Term, b: EB.Term) => app(app(C.Var(EB.Constructors.Vars.Foreign("$add")), a), b);
const A = atom("A");
const B = atom("B");
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.normalize(term));
const installed = (body: EB.Term, handler: EB.Term) => C.Block([C.Stmt.Let("h", handler, NF.Any)], C.Reset(body, A, v(0)));
const deep = (value: EB.Term) => C.Reset(app(v(0), value), A, v(2));

describe("identity-bearing delimiters", () => {
	it("passes the payload to its delimiter's handler", () => {
		const handler = lambda("p", lambda("k", add(v(1), num(10))));
		expect(evaluate(C.Reset(C.Capture(A, num(7)), A, handler))).toMatchObject({ type: "Lit", value: Lit.Num(17) });
	});

	it("captures through an unrelated delimiter", () => {
		const handler = lambda("p", lambda("k", v(1)));
		const inner = C.Reset(C.Capture(A, num(7)), B, lambda("p", lambda("k", num(99))));
		expect(evaluate(C.Reset(inner, A, handler))).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});

	it("restores its handler for another operation in the resumed body", () => {
		const body = add(C.Capture(A, num(1)), C.Capture(A, num(2)));
		const handler = lambda("p", lambda("k", deep(v(1))));
		expect(evaluate(installed(body, handler))).toMatchObject({ type: "Lit", value: Lit.Num(3) });
	});

	it("runs a handler under the enclosing delimiter", () => {
		const inner = C.Reset(C.Capture(A, num(1)), A, lambda("p", lambda("k", C.Capture(A, add(v(1), num(10))))));
		const outer = C.Reset(inner, A, lambda("p", lambda("k", v(1))));
		expect(evaluate(outer)).toMatchObject({ type: "Lit", value: Lit.Num(11) });
	});

	it("replays a captured continuation for each resumption", () => {
		const body = add(num(10), C.Capture(A, num(0)));
		const handler = lambda("p", lambda("k", add(deep(num(1)), deep(num(2)))));
		expect(evaluate(installed(body, handler))).toMatchObject({ type: "Lit", value: Lit.Num(23) });
	});
});
