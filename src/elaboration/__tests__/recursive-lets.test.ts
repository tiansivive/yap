import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import { options } from "@yap/shared/config/options";

import { elaborate } from "./utils";

/* Verbose display renders μ-wrapped terms structurally instead of as their source name. */
options.verbose = true;

/** The Mu binding of a term, when it is one. */
const muOf = (tm: EB.Term) =>
	match(tm)
		.with(EB.CtorPatterns.Mu, ({ binding }) => binding)
		.otherwise(() => undefined);

/** The values of a block term's let statements. */
const letValues = (tm: EB.Term): EB.Term[] =>
	match(tm)
		.with({ type: "Block" }, ({ statements }) => statements.flatMap(s => (s.type === "Let" ? [s.value] : [])))
		.otherwise(() => []);

describe("Recursive lets", () => {
	describe("Mu wrapping of self-referencing type definitions", () => {
		it("wraps a recursive type constructor", () => {
			const { pretty, structure } = elaborate(`let List: (t: Type) -> Type = \\t -> | #nil Unit | #cons { head: t, tail: List t }`);

			expect(muOf(structure.term.value)?.source).toBe("List");
			expect(pretty).toMatchSnapshot();
		});

		it("wraps a ground recursive type", () => {
			const { pretty, structure } = elaborate(`let Tree: Type = | #leaf Unit | #node { left: Tree, right: Tree }`);

			expect(muOf(structure.term.value)?.source).toBe("Tree");
			expect(pretty).toMatchSnapshot();
		});

		/*
		 * No annotation to guide it: detection is positional, not annotation-driven.
		 * A variant literal is always a type — variant inference runs under muContext —
		 * so the self-reference is flagged and the Mu wrap fires automatically.
		 */
		it("wraps an unannotated recursive variant definition", () => {
			const { pretty, structure } = elaborate(`let List = \\t -> | #nil Unit | #cons { head: t, tail: List t }`);

			expect(muOf(structure.term.value)?.source).toBe("List");
			expect(pretty).toMatchSnapshot();
		});
	});

	describe("definitions that must not wrap", () => {
		it("leaves a non-recursive type definition bare", () => {
			const { pretty, structure } = elaborate(`let Pair: Type = { x: Num, y: Num }`);

			expect(muOf(structure.term.value)).toBeUndefined();
			expect(pretty).toMatchSnapshot();
		});

		/* A self-reference from a value position is general recursion, not a recursive type. */
		it("leaves a recursive value function bare", () => {
			const { pretty, structure } = elaborate(`let f: Num -> Num = \\n -> f n`);

			expect(muOf(structure.term.value)).toBeUndefined();
			expect(pretty).toMatchSnapshot();
		});

		/*
		 * A type-level reference to an earlier, already-elaborated definition flags a
		 * level with no open window — a no-op. Neither block let may wrap.
		 */
		it("leaves references to closed definitions bare", () => {
			const { pretty, structure } = elaborate(`let m = { let A: Type = { x: Num }; let B: Type = { a: A }; return 1; }`);

			const wrapped = letValues(structure.term.value).map(muOf);
			expect(wrapped).toEqual([undefined, undefined]);
			expect(pretty).toMatchSnapshot();
		});
	});

	describe("nested windows", () => {
		/*
		 * The outer definition's self-reference sits inside a nested let's window:
		 * the inner window pops unflagged while the outer frame stays flagged.
		 */
		it("detects outer recursion through an inner let's window", () => {
			const { pretty, structure } = elaborate(`let Outer: (t: Type) -> Type = \\t -> { let Inner: Type = | #wrap (Outer t) | #stop Unit; return Inner; }`);

			const mu = muOf(structure.term.value);
			expect(mu?.source).toBe("Outer");

			const inner = match(structure.term.value)
				.with(EB.CtorPatterns.Mu, ({ body }) =>
					match(body)
						.with(EB.CtorPatterns.Lambda, ({ body: block }) => letValues(block).map(muOf))
						.otherwise(() => undefined),
				)
				.otherwise(() => undefined);
			expect(inner).toEqual([undefined]);

			expect(pretty).toMatchSnapshot();
		});
	});
});
