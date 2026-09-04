import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

import { recursion } from "../recursion";

describe("recursion windows", () => {
	it("reports an unflagged window as not recursed", () => {
		const program = function* () {
			return yield* recursion.detect(0, () => Eff.of("value"));
		};

		const [answer, frames] = Eff.run(program, [recursion.handlers()]);

		expect(answer).toEqual(["value", false]);
		expect(frames).toEqual([]);
	});

	it("reports a window flagged at its level as recursed", () => {
		const program = function* () {
			return yield* recursion.detect(3, function* () {
				yield* recursion.flag(3);

				return "value";
			});
		};

		const [answer] = Eff.run(program, [recursion.handlers()]);

		expect(answer).toEqual(["value", true]);
	});

	it("flags the outer window from inside an inner one", () => {
		const program = function* () {
			return yield* recursion.detect(0, function* () {
				return yield* recursion.detect(1, function* () {
					yield* recursion.flag(0);

					return "inner";
				});
			});
		};

		const [answer] = Eff.run(program, [recursion.handlers()]);

		/* The inner window pops unflagged; the outer frame carries the flag. */
		expect(answer).toEqual([["inner", false], true]);
	});

	it("ignores flags with no open window at that level", () => {
		const program = function* () {
			yield* recursion.flag(7);

			const first = yield* recursion.detect(2, function* () {
				yield* recursion.flag(9);

				return "a";
			});

			/* Same level, fresh frame: the popped window's state cannot leak. */
			const second = yield* recursion.detect(2, () => Eff.of("b"));

			return [first, second] as const;
		};

		const [answer] = Eff.run(program, [recursion.handlers()]);

		expect(answer).toEqual([
			["a", false],
			["b", false],
		]);
	});
});
