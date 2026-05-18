import { describe, it, expect } from "vitest";
import { tseitin } from "../cnf";
import { Build } from "../ivl/build";
import * as DSL from "../ivl/dsl";

describe("Tseitin CNF", () => {
	const atom = (name: string) => DSL.eq(DSL.x, DSL.int(0), name);

	describe("single atoms", () => {
		it("produces unit clause for True", () => {
			const result = tseitin(DSL.T);
			expect(result.clauses.length).toBeGreaterThanOrEqual(2);
		});

		it("produces negated unit for False", () => {
			const result = tseitin(DSL.F);
			expect(result.clauses.some(c => c.literals.some(l => l < 0))).toBe(true);
		});

		it("encodes a single atom as a single variable", () => {
			const result = tseitin(atom("x"));
			expect(result.atoms.size).toBe(1);
			expect(result.clauses.some(c => c.origin === "x")).toBe(true);
		});
	});

	describe("connectives", () => {
		it("encodes Not as negation of inner", () => {
			const result = tseitin(DSL.not(atom("x"), "neg"));
			expect(result.clauses.length).toBeGreaterThan(0);
		});

		it("encodes And with implication clauses", () => {
			const result = tseitin(DSL.and(atom("a"), atom("b")));
			expect(result.clauses.length).toBeGreaterThanOrEqual(4);
		});

		it("encodes Or with implication clauses", () => {
			const result = tseitin(DSL.or(atom("a"), atom("b")));
			expect(result.clauses.length).toBeGreaterThanOrEqual(4);
		});

		it("encodes Implies", () => {
			const result = tseitin(DSL.implies(atom("a"), atom("b"), "impl"));
			expect(result.clauses.length).toBeGreaterThanOrEqual(4);
		});
	});

	describe("origin preservation", () => {
		it("carries origin through encoding", () => {
			const result = tseitin(Build.andWithOrigin([atom("x"), atom("y")], "my-constraint"));
			expect(result.clauses.some(c => c.origin === "my-constraint")).toBe(true);
		});
	});

	describe("atom deduplication", () => {
		it("reuses same variable for identical atoms", () => {
			const result = tseitin(DSL.and(atom("x"), atom("x")));
			expect(result.atoms.size).toBe(1);
		});
	});
});
