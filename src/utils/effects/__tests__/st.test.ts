import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

const state = Eff.st<{ scope: string; count: number }>();
const fail = Eff.except<string>();
const initial = { scope: "outer", count: 0 };

describe("scoped state", () => {
	it("restores one field and preserves updates to the other fields", () => {
		const program = function* () {
			return yield* state.local(
				"scope",
				"inner",
				(function* () {
					expect((yield* state.get()).scope).toBe("inner");
					yield* state.put({ scope: "changed", count: 3 });
					return 7;
				})(),
			);
		};

		expect(Eff.run(program, [state.handlers(initial)])).toEqual([7, { scope: "outer", count: 3 }]);
	});

	it("restores nested scopes in order while retaining accumulated updates", () => {
		const program = function* () {
			return yield* state.local(
				"scope",
				"middle",
				(function* () {
					const before = yield* state.get();
					const inner = yield* state.local(
						"scope",
						"inner",
						(function* () {
							return yield* state.modify(s => ({ ...s, count: s.count + 1 }));
						})(),
					);
					const after = yield* state.get();
					yield* state.modify(s => ({ ...s, count: s.count + 1 }));
					return [before, inner, after];
				})(),
			);
		};

		expect(Eff.run(program, [state.handlers(initial)])).toEqual([
			[
				{ scope: "middle", count: 0 },
				{ scope: "inner", count: 1 },
				{ scope: "middle", count: 1 },
			],
			{ scope: "outer", count: 2 },
		]);
	});

	it("restores its field when a nested handler catches an error", () => {
		const program = function* () {
			return yield* state.local(
				"scope",
				"inner",
				(function* () {
					const [answer] = yield* Eff.with([fail.handlers()], function* () {
						yield* state.modify(s => ({ ...s, count: 1 }));
						return yield* fail.raise("stop");
					});
					return Eff.failed(answer);
				})(),
			);
		};

		expect(Eff.run(program, [state.handlers(initial)])).toEqual([true, { scope: "outer", count: 1 }]);
	});

	it("reports the current field value when the enclosing run aborts", () => {
		const program = function* () {
			return yield* state.local(
				"scope",
				"inner",
				(function* () {
					yield* state.modify(s => ({ ...s, count: 1 }));
					return yield* fail.raise("stop");
				})(),
			);
		};

		const [answer, final] = Eff.run(program, [state.handlers(initial), fail.handlers()]);
		expect(Eff.failed(answer)).toBe(true);
		expect(final).toEqual({ scope: "inner", count: 1 });
	});
});
