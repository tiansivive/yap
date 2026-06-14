import { match, P } from "ts-pattern";
import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import type { Literal } from "../../cdcl";
import * as Core from "../../core";
import type * as Encoding from "../../encoding";
import { CNF } from "../../encoding/index";
import { conflictValue, tag } from "../../__tests__/either";
import * as Theory from "../index";

const literal = (encoding: Encoding.State, op: Encoding.Atom.T["op"]): Literal =>
	match([...encoding.atoms.entries()].find(([, atom]) => atom.op === op))
		.with([P.number, P._], ([lit]) => lit)
		.with(undefined, () => {
			throw new Error(`missing ${op} atom`);
		})
		.exhaustive();

describe("Theory orchestration", () => {
	it("registers equality atoms with both literal polarities", () => {
		const encoding = CNF.encode(DSL.eq(DSL.x, DSL.y));
		const prepared = Theory.setup(encoding);
		const eq = literal(encoding, "=");

		expect(prepared.equalities.some(entry => entry.literal === eq && entry.equality.positive)).toBe(true);
		expect(prepared.equalities.some(entry => entry.literal === -eq && !entry.equality.positive)).toBe(true);
	});

	it("detects EUF contradiction from CNF atom registration", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const fy = Build.app("f", [DSL.y], Build.Int);
		const encoding = CNF.encode(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(fx, fy)));
		const prepared = Theory.setup(encoding);
		const eq = literal(encoding, "=");
		const neq = literal(encoding, "!=");
		const asserted = conflictValue(Theory.assert(prepared.state, prepared.arena, eq)).state;
		const conflict = Theory.assert(asserted, prepared.arena, neq);

		expect(tag(conflict)).toBe("Left");
	});

	it("detects EUF contradiction during theory check", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const fy = Build.app("f", [DSL.y], Build.Int);
		const encoding = CNF.encode(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(fx, fy)));
		const prepared = Theory.setup(encoding);
		const eq = literal(encoding, "=");
		const asserted = conflictValue(Theory.assert(prepared.state, prepared.arena, eq)).state;
		const conflict = Theory.check(asserted, prepared.arena);

		expect(tag(conflict)).toBe("Left");
	});

	it("installs setup into the core solver state", () => {
		const encoding = CNF.encode(DSL.eq(DSL.x, DSL.y));
		const [collector, state] = Core.run(
			Core.Do(function* () {
				return yield* Theory.install(encoding);
			}),
		);

		expect(tag(collector.result)).toBe("Right");
		expect(state.arena.nodes.size).toBeGreaterThan(0);
		expect(state.theories.euf.literalMap.size).toBeGreaterThan(0);
	});

	it("enters and backtracks theory decision levels", () => {
		const encoding = CNF.encode(DSL.eq(DSL.x, DSL.y));
		const prepared = Theory.setup(encoding);
		const eq = literal(encoding, "=");
		const entered = Theory.enter(prepared.state);
		const merged = conflictValue(Theory.assert(entered, prepared.arena, eq)).state;

		expect(merged.euf.stack.length).toBe(1);
		expect(merged.arithmetic.stack.length).toBe(1);

		const backtracked = Theory.backtrack(merged);

		expect(backtracked.euf.stack.length).toBe(0);
		expect(backtracked.arithmetic.stack.length).toBe(0);
	});
});
