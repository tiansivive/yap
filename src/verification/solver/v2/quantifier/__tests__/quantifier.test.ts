import * as E from "fp-ts/Either";
import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import type { IVL } from "../../../ivl/types";
import * as Core from "../../core";
import * as EUF from "../../euf";
import * as EMatch from "../ematch";
import * as MBQI from "../mbqi";
import { State } from "../model";
import * as Triggers from "../triggers";

const TEST_LITERAL = 7;
const IMPOSSIBLE_BOUND = 10;

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

		const [result] = run(EMatch.multi([trigger]), withArena(fa.state));

		expect(result.substitutions.length).toBeGreaterThan(0);
	});
});

describe("v2 E-matching rounds", () => {
	it("generates a lemma from an E-matching substitution", () => {
		const a = EUF.Intern.raw(EUF.Intern.empty, "a", [], Build.Int);
		const fa = EUF.Intern.raw(a.state, "f", [a.id], Build.Int);
		const fx = Build.app("f", [DSL.x], Build.Int);
		const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);
		const [result, state] = run(
			EMatch.round(),
			withArena(
				fa.state,
				State.from(Triggers.extract(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }]))),
				CNF.withAtom(TEST_LITERAL, "!=", [f_a, DSL.int(1)]),
			),
		);

		expect(result.lemmas).toHaveLength(1);
		expect(result.lemmas[0].clause.origin).toBe("quantifier:forall_f_neq_1:gen0");
		expect(result.lemmas[0].source.tag).toBe("ematch");
		expect(state.quantifiers.generation).toBe(1);
	});
});

describe("v2 MBQI", () => {
	it("detects triggerless arithmetic contradiction from body constants", () => {
		const v = Build.var_("v", Build.Real);
		const formula = DSL.forall(
			[{ name: "v", sort: Build.Real }],
			DSL.implies(DSL.eq(v, DSL.int(1)), DSL.gt(v, DSL.int(IMPOSSIBLE_BOUND))),
			"arithmetic_forall",
		);
		const [result] = run(MBQI.round(), withArena(EUF.Intern.empty, State.from(Triggers.extract(formula))));

		expect(result.lemmas.some(lemma => lemma.clause.literals.length === 0)).toBe(true);
		expect(result.instantiations.some(i => i.simplification.tag === "contradiction")).toBe(true);
	});
});

const run = <A>(ma: Core.G<A>, state: Core.State): [A, Core.State] => {
	const [collector, next] = Core.run(
		Core.Do(function* () {
			return yield* ma;
		}),
		Core.Env.default,
		state,
	);
	return [
		E.getOrElseW((err: Core.Err) => {
			throw new Error(err.cause.tag);
		})(collector.result),
		next,
	];
};

const withArena = (arena: EUF.Arena.State, quantifiers = State.empty, encoding = Core.State.initial.encoding): Core.State => ({
	...Core.State.initial,
	arena,
	theories: { ...Core.State.initial.theories, euf: EUF.CC.init(arena) },
	quantifiers,
	encoding,
});

const CNF = {
	withAtom: (literal: number, op: IVL.AtomOp, args: [IVL.Term, IVL.Term]) => ({
		...Core.State.initial.encoding,
		keyIndex: new Map([["test", literal]]),
		atoms: new Map([[literal, { op, args }]]),
	}),
};
