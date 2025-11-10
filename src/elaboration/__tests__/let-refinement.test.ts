import { describe, it, expect } from "vitest";
import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import * as Sub from "@yap/elaboration/unification/substitution";
import { solve } from "@yap/elaboration/solver";
import { update, set } from "@yap/utils";
import * as F from "fp-ts/function";

// Helper: parse expression starting at Ann
const parseAnn = (src: string) => {
	const g = { ...Grammar, ParserStart: "Ann" } as typeof Grammar;
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(g));
	parser.feed(src);

	if (parser.results.length !== 1) {
		throw new Error("Ambiguous parse");
	}
	return parser.results[0];
};

// Elaborate term and return pretty type string
const elaborate = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	const term = parseAnn(src);
	const ctx = Lib.defaultContext();
	const result = EB.V2.Do(function* () {
		const [tm, ty] = yield* EB.infer.gen(term);
		const { constraints, metas } = yield* EB.V2.listen();
		// Solve constraints to get substitution
		const subst = yield* EB.V2.local(
			update("metas", (ms: any) => ({ ...ms, ...metas })),
			solve(constraints),
		);
		// Apply substitution to context
		const zonked = F.pipe(
			ctx,
			update("metas", (prev: any) => ({ ...prev, ...metas })),
			set("zonker", Sub.compose(subst, ctx.zonker)),
		);
		return { tm, ty, ctx: zonked } as const;
	})(ctx);
	if (result.result._tag === "Left") {
		throw new Error(EB.V2.display(result.result.left));
	}
	return result.result.right;
};

describe.skip("let refinement environment capture", () => {
	it("captures lambda parameter in nested let with refinement", () => {
		const src = `\\x -> { let f = \\g -> (g x) + 1; return f (\\y -> y); }`;
		const { ty, ctx } = elaborate(src);

		const printed = NF.display(ty, ctx);

		// Should reference parameter 'x' not outer variable
		expect(printed).toMatch(/\(g x\)/);
		expect(printed).toMatch(/\bf\b/); // inner let binder
		expect(printed).toMatchSnapshot();
	});

	it("preserves multiple nested let binders in closure", () => {
		const src = `\\x -> { let a = x + 1; let b = \\f -> (f a); return b (\\z -> z); }`;
		const { ty, ctx } = elaborate(src);

		const printed = NF.display(ty, ctx);

		// Both 'a' and 'b' should be in closure env
		expect(printed).toMatch(/\ba\b/);
		expect(printed).toMatch(/\bb\b/);
		expect(printed).toMatch(/\(f a\)/);
		expect(printed).toMatchSnapshot();
	});

	it("handles deeply nested closures with parameter capture", () => {
		const src = `\\x -> { let f = \\g -> { let h = \\k -> (k x) + 1; return h g; }; return f (\\y -> y); }`;
		const { ty, ctx } = elaborate(src);

		const printed = NF.display(ty, ctx);

		// All binders should be preserved
		expect(printed).toMatch(/\bf\b/);
		expect(printed).toMatch(/\bh\b/);
		expect(printed).toMatch(/\(k x\)/);
		expect(printed).toMatchSnapshot();
	});

	it("block with let and liquid refinement captures correct variable", () => {
		const src = `\\n -> { let inc = \\x -> x + 1; return inc n; }`;
		const { ty, ctx } = elaborate(src);

		const printed = NF.display(ty, ctx);

		// Should contain 'inc' binder and reference to parameter 'n'
		expect(printed).toMatch(/\binc\b/);
		// Verify no aliasing like 'n = inc' or 'inc = n'
		expect(printed).not.toMatch(/n = inc/);
		expect(printed).not.toMatch(/inc = n/);
		expect(printed).toMatchSnapshot();
	});

	it("closure environment uses correct context for nested refinements", () => {
		// This test specifically targets the pretty-printer fix
		const src = `\\x -> { let f = \\y -> (y x) + 1; let g = \\z -> (z x) + 2; return (f (\\a -> a)) + (g (\\b -> b)); }`;
		const { ty, ctx } = elaborate(src);

		const printed = NF.display(ty, ctx);

		// Should have both '(y x)' and '(z x)', not aliased references
		expect(printed).toMatch(/\(y x\)/);
		expect(printed).toMatch(/\(z x\)/);
		// Ensure no cross-contamination like 'f = g' in envs
		expect(printed).not.toMatch(/f = g/);
		expect(printed).not.toMatch(/g = f/);
		expect(printed).toMatchSnapshot();
	});
});
