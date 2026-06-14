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

const run = <A>(prepared: Theory.Setup, gen: () => Core.G<A>): [Core.Collector<A>, Core.State] =>
	Core.run(Core.Do(gen), Core.Env.default, { ...Core.State.initial, arena: prepared.arena, theories: prepared.state });

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
		const [collector] = run(prepared, function* () {
			yield* Theory.assert(eq);
			return yield* Theory.assert(neq);
		});
		const conflict = conflictValue(collector.result);

		expect(conflict).toBeDefined();
	});

	it("detects EUF contradiction during theory check", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const fy = Build.app("f", [DSL.y], Build.Int);
		const encoding = CNF.encode(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(fx, fy)));
		const prepared = Theory.setup(encoding);
		const eq = literal(encoding, "=");
		const [collector] = run(prepared, function* () {
			yield* Theory.assert(eq);
			return yield* Theory.check();
		});
		const conflict = conflictValue(collector.result);

		expect(conflict).toBeDefined();
	});

	it("registers arithmetic atoms into the arithmetic state", () => {
		const encoding = CNF.encode(DSL.gte(DSL.x, DSL.int(0)));
		const prepared = Theory.setup(encoding);
		const gte = literal(encoding, ">=");

		expect(prepared.arithmetics.some(entry => entry.literal === gte)).toBe(true);
		expect(prepared.state.arithmetic.constraints.has(gte)).toBe(true);
		expect(prepared.state.arithmetic.constraints.has(-gte)).toBe(true);
	});

	it("detects arithmetic contradiction at the theory boundary", () => {
		const encoding = CNF.encode(DSL.and(DSL.gt(DSL.x, DSL.int(0)), DSL.lt(DSL.x, DSL.int(0))));
		const prepared = Theory.setup(encoding);
		const gt = literal(encoding, ">");
		const lt = literal(encoding, "<");
		const [collector] = run(prepared, function* () {
			yield* Theory.assert(gt);
			return yield* Theory.assert(lt);
		});
		const conflict = conflictValue(collector.result);

		expect(conflict).toBeDefined();
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
		const [collector] = run(prepared, function* () {
			yield* Theory.enter(1);
			yield* Theory.assert(eq);
			const merged = yield* Core.State.get();
			yield* Theory.backtrack(1, 0);
			const backtracked = yield* Core.State.get();
			return { merged: merged.theories, backtracked: backtracked.theories };
		});
		const { merged, backtracked } = conflictValue(collector.result);

		expect(merged.euf.stack.length).toBe(1);
		expect(merged.arithmetic.stack.length).toBe(1);

		expect(backtracked.euf.stack.length).toBe(0);
		expect(backtracked.arithmetic.stack.length).toBe(0);
	});
});
