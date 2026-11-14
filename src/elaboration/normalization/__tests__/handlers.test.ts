import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { declaration, elaborateModule } from "../../__tests__/module";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const atom = (name: string) => C.Lit(Lit.Atom(name));
const num = (value: number) => C.Lit(Lit.Num(value));
const bound = (index: number) => C.Var(EB.Bound(index));
const lambda = (name: string, body: EB.Term) => C.Lambda(name, "Explicit", body, EB.Any);
const app = (f: EB.Term, x: EB.Term) => C.App("Explicit", f, x);
const add = (a: EB.Term, b: EB.Term) => app(app(C.Var(EB.Constructors.Vars.Foreign("$add")), a), b);
const suspend = (identity: EB.Term, payload: EB.Term) => C.Suspend(identity, payload, atom("Num"));
const A = atom("A");
const B = atom("B");
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.normalize(term));
const install = (identity: EB.Term, handler: EB.Term, term: EB.Term) => C.Reset(term, { identity, handler });

const source = (text: string) => {
	const module = elaborateModule(text);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	const result = declaration(module, "result")?.elaborated;
	if (!result) {
		throw new Error("Expected an elaborated result declaration");
	}
	return runNF(result.ctx, () => NF.normalize(result.tm), result.registry);
};

describe("concrete handlers", () => {
	it.each<[string, string, number | string]>([
		["normal return", "foreign E: Effect Num Num; let result: Num = with E: (\\p k -> k (p + 1)) in 6;", 6],
		["named operation", "foreign E: Effect Num Num; let result: Num = with E: (\\p k -> k (p + 1)) in suspend @E 6;", 7],
		["identity alias", "foreign E: Effect Num Num; let Alias = E; let result: Num = with Alias: (\\p k -> k (p + 1)) in suspend @E 6;", 7],
		["polymorphic foreign", "foreign Echo: (a: Type) => Effect a a; let result: Num = with Echo: (\\p k -> k p) in suspend @Echo 42;", 42],
		[
			"polymorphic resumption at another type",
			"foreign Echo: (a: Type) => Effect a a; let result: Num = with Echo: (\\p k -> k p) in match (suspend @Echo true) | true -> suspend @Echo 42 | false -> 0;",
			42,
		],
		[
			"explicit identity factory",
			"foreign E: Effect Num Num; let F: (a: Type) => Effect Num Num = \\a => E; let result: Num = with (F @Num): (\\p k -> k (p + 1)) in suspend @E 6;",
			7,
		],

		["anonymous operation", "let result: Num = reset (suspend (\\k -> k 7));", 7],
		["anonymous answer change", 'let result: String = reset ((suspend (\\k -> "hello")) : Num);', "hello"],
		["nearest anonymous reset", "let result: Num = reset (1 + (reset ((suspend (\\k -> 7)) : Num)));", 8],
		["anonymous operation across a named reset", "foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset (reset @E (suspend (\\k -> k 7)));", 7],
		[
			"named operation across an anonymous reset",
			"foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset @E (reset (suspend @E (\\k -> k 7)));",
			7,
		],
		[
			"generated deep handler",
			"foreign E: Effect Num Num; let result: Num = with E: (\\p k -> k (p + 1)) in match (suspend @E 1) | 2 -> suspend @E 2 | _ -> 0;",
			3,
		],
		[
			"handler suspension reaches its enclosing handler",
			"foreign E: Effect Num Num; let result: Num = with E: (\\p k -> k (p + 10)) in with E: (\\p k -> suspend @E p) in suspend @E 1;",
			11,
		],
	])("evaluates %s", (_name, text, value) => {
		expect(source(text)).toMatchObject({ type: "Lit", value: { value } });
	});

	it("evaluates two operations used as infix operands", () => {
		expect(source("foreign E: Effect Num Num; let result: Num = with E: (\\p k -> k (p + 1)) in (suspend @E 1) + (suspend @E 2);")).toMatchObject({
			type: "Lit",
			value: Lit.Num(5),
		});
	});

	it("keeps specialized foreign installation explicit as a pending boundary", () => {
		expect(() => source("foreign Echo: (a: Type) => Effect a a; let result: Num = with (Echo @Num): (\\p k -> k p) in suspend @Echo 42;")).toThrow(
			"Specialized foreign handler installation is pending",
		);
	});

	it("selects the nearest matching delimiter", () => {
		const outer = lambda("p", lambda("k", num(99)));
		const inner = lambda("p", lambda("k", add(bound(1), num(10))));
		expect(evaluate(install(A, outer, install(A, inner, suspend(A, num(7)))))).toMatchObject({ type: "Lit", value: Lit.Num(17) });
	});

	it("restores intervening delimiters in the captured continuation", () => {
		const resume = lambda("p", lambda("k", app(bound(0), bound(1))));
		const inner = lambda("p", lambda("k", app(bound(0), add(bound(1), num(10)))));
		const body = add(suspend(A, num(1)), suspend(B, num(2)));
		expect(evaluate(install(A, resume, install(B, inner, body)))).toMatchObject({ type: "Lit", value: Lit.Num(13) });
	});

	it("executes an elaboration Bubble under its matching handler", () => {
		const handler = lambda("p", lambda("k", app(bound(0), bound(1))));
		const body = C.Bubble(7, NF.Constructors.Atom("Num"), [], suspend(A, num(9)));
		expect(evaluate(install(A, handler, add(num(1), body)))).toMatchObject({ type: "Lit", value: Lit.Num(10) });
	});
});
