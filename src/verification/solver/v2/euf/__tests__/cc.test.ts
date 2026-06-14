import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import { conflictOf, conflictValue, tag } from "../../__tests__/either";
import * as EUF from "../index";

const EQ_XY = 1;
const NEQ_FX_FY = 2;
const EQ_AB = 3;

const fixture = () => {
	const fx = Build.app("f", [DSL.x], Build.Int);
	const fy = Build.app("f", [DSL.y], Build.Int);
	const x = EUF.Intern.term(EUF.Intern.empty, DSL.x);
	const y = EUF.Intern.term(x.state, DSL.y);
	const a = EUF.Intern.term(y.state, DSL.a);
	const b = EUF.Intern.term(a.state, DSL.b);
	const ix = EUF.Intern.term(b.state, fx);
	const iy = EUF.Intern.term(ix.state, fy);

	return { arena: iy.state, x: x.id, y: y.id, a: a.id, b: b.id, fx: ix.id, fy: iy.id };
};

describe("EUF congruence closure", () => {
	it("merges asserted equalities", () => {
		const f = fixture();
		const state = EUF.CC.register(EUF.CC.init(f.arena), EQ_XY, { a: f.x, b: f.y, positive: true });
		const merged = conflictValue(EUF.CC.assert(state, f.arena, EQ_XY)).state;

		expect(EUF.CC.find(merged, f.x)).toBe(EUF.CC.find(merged, f.y));
	});

	it("propagates equality through congruent applications", () => {
		const f = fixture();
		const state = EUF.CC.register(EUF.CC.init(f.arena), EQ_XY, { a: f.x, b: f.y, positive: true });
		const merged = conflictValue(EUF.CC.assert(state, f.arena, EQ_XY)).state;

		expect(EUF.CC.find(merged, f.fx)).toBe(EUF.CC.find(merged, f.fy));
		expect(EUF.CC.explain(merged, f.fx, f.fy)).toEqual([EQ_XY]);
	});

	it("reports conflict for asserted disequality in one class", () => {
		const f = fixture();
		const initial = EUF.CC.init(f.arena);
		const withEquality = EUF.CC.register(initial, EQ_XY, { a: f.x, b: f.y, positive: true });
		const withDisequality = EUF.CC.register(withEquality, NEQ_FX_FY, { a: f.fx, b: f.fy, positive: false });
		const merged = conflictValue(EUF.CC.assert(withDisequality, f.arena, EQ_XY)).state;
		const conflict = EUF.CC.assert(merged, f.arena, NEQ_FX_FY);

		expect(tag(conflict)).toBe("Left");
		expect(conflictOf(conflict).clause.literals).toEqual([-EQ_XY, -NEQ_FX_FY]);
	});

	it("detects violated disequalities during check", () => {
		const f = fixture();
		const initial = EUF.CC.init(f.arena);
		const withEquality = EUF.CC.register(initial, EQ_XY, { a: f.x, b: f.y, positive: true });
		const withDisequality = EUF.CC.register(withEquality, NEQ_FX_FY, { a: f.fx, b: f.fy, positive: false });
		const merged = conflictValue(EUF.CC.assert(withDisequality, f.arena, EQ_XY)).state;
		const conflict = EUF.CC.check(merged);

		expect(tag(conflict)).toBe("Left");
		expect(conflictOf(conflict).clause.literals).toEqual([-EQ_XY, -NEQ_FX_FY]);
	});

	it("restores equality classes after pop", () => {
		const f = fixture();
		const state = EUF.CC.register(EUF.CC.push(EUF.CC.init(f.arena)), EQ_XY, { a: f.x, b: f.y, positive: true });
		const merged = conflictValue(EUF.CC.assert(state, f.arena, EQ_XY)).state;
		const popped = EUF.CC.pop(merged);

		expect(EUF.CC.find(popped, f.x)).not.toBe(EUF.CC.find(popped, f.y));
	});

	it("restores nested decision levels after multi-level push and pop", () => {
		const f = fixture();
		const base = EUF.CC.init(f.arena);
		const levelOne = EUF.CC.push(base);
		const withFirstMerge = conflictValue(EUF.CC.assert(EUF.CC.register(levelOne, EQ_XY, { a: f.x, b: f.y, positive: true }), f.arena, EQ_XY)).state;
		const levelTwo = EUF.CC.push(withFirstMerge);
		const withSecondMerge = conflictValue(EUF.CC.assert(EUF.CC.register(levelTwo, EQ_AB, { a: f.a, b: f.b, positive: true }), f.arena, EQ_AB)).state;

		expect(EUF.CC.find(withSecondMerge, f.x)).toBe(EUF.CC.find(withSecondMerge, f.y));
		expect(EUF.CC.find(withSecondMerge, f.a)).toBe(EUF.CC.find(withSecondMerge, f.b));

		const afterOnePop = EUF.CC.pop(withSecondMerge);
		expect(EUF.CC.find(afterOnePop, f.x)).toBe(EUF.CC.find(afterOnePop, f.y));
		expect(EUF.CC.find(afterOnePop, f.a)).not.toBe(EUF.CC.find(afterOnePop, f.b));

		const afterTwoPop = EUF.CC.pop(afterOnePop);
		expect(EUF.CC.find(afterTwoPop, f.x)).not.toBe(EUF.CC.find(afterTwoPop, f.y));
		expect(EUF.CC.find(afterTwoPop, f.a)).not.toBe(EUF.CC.find(afterTwoPop, f.b));
	});
});
