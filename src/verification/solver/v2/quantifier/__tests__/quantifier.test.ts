import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import * as EUF from "../../euf";
import * as EMatch from "../ematch";
import * as MBQI from "../mbqi";
import * as Triggers from "../triggers";

const clauseId = 100;

describe("v2 quantifier triggers", () => {
	it("extracts annotated trigger applications from forall formulas", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const formula = DSL.forall([{ name: "x", sort: Build.Int }], DSL.eq(fx, DSL.x), "test-forall", [{ terms: [fx] }]);
		const infos = Triggers.extract(formula);

		expect(infos).toHaveLength(1);
		expect(infos[0].triggers).toHaveLength(1);
		expect(infos[0].triggers[0].terms).toHaveLength(1);
	});

	it("extracts quantifiers nested under conjunction", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const gy = Build.app("g", [DSL.y], Build.Int);
		const qx = DSL.forall([{ name: "x", sort: Build.Int }], DSL.eq(fx, DSL.x), "qx", [{ terms: [fx] }]);
		const qy = DSL.forall([{ name: "y", sort: Build.Int }], DSL.eq(gy, DSL.y), "qy", [{ terms: [gy] }]);

		expect(Triggers.extract(DSL.and(qx, qy))).toHaveLength(2);
	});
});

describe("v2 E-matching", () => {
	it("matches a known function application in the arena", () => {
		const a = EUF.Intern.raw(EUF.Intern.empty, "a", [], Build.Int);
		const fa = EUF.Intern.raw(a.state, "f", [a.id], Build.Int);
		const trigger = Build.app("f", [DSL.x], Build.Int);

		expect(EMatch.multi([trigger], fa.state, id => id).substitutions.length).toBeGreaterThan(0);
	});
});

describe("v2 E-matching rounds", () => {
	it("generates a lemma from an E-matching substitution", () => {
		const a = EUF.Intern.raw(EUF.Intern.empty, "a", [], Build.Int);
		const fa = EUF.Intern.raw(a.state, "f", [a.id], Build.Int);
		const fx = Build.app("f", [DSL.x], Build.Int);
		const state = EMatch.create(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }]));
		const result = EMatch.round(
			state,
			fa.state,
			id => id,
			() => clauseId,
			() => [7],
		);

		expect(result.lemmas).toHaveLength(1);
		expect(result.lemmas[0].clause.origin).toBe("quantifier:forall_f_neq_1:gen0");
		expect(result.lemmas[0].source.tag).toBe("ematch");
		expect(result.state.generation).toBe(1);
	});
});

describe("v2 MBQI", () => {
	it("detects triggerless arithmetic contradiction from body constants", () => {
		const v = Build.var_("v", Build.Real);
		const formula = DSL.forall([{ name: "v", sort: Build.Real }], DSL.implies(DSL.eq(v, DSL.int(1)), DSL.gt(v, DSL.int(10))), "arithmetic_forall");
		const result = MBQI.round(
			Triggers.extract(formula),
			EUF.Intern.empty,
			new Set(),
			0,
			() => clauseId,
			() => [],
		);

		expect(result.lemmas.some(lemma => lemma.clause.literals.length === 0)).toBe(true);
		expect(result.instantiations.some(i => i.simplification.tag === "contradiction")).toBe(true);
	});
});
