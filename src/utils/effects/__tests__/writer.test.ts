import { describe, expect, it } from "vitest";

import { Monoid } from "fp-ts/lib/Monoid";

import * as Eff from "@yap/utils/effects";

const monoid: Monoid<string[]> = { empty: [], concat: (x, y) => [...x, ...y] };
const log = Eff.writer(monoid);
const fail = Eff.except<string>();

describe("writer", () => {
	it("accumulates what a program tells", () => {
		const program = function* () {
			yield* log.tell(["a"]);
			yield* log.tell(["b"]);

			return "done";
		};

		expect(Eff.run(program, [log.handlers()])).toEqual(["done", ["a", "b"]]);
	});

	it("peeks at everything told so far", () => {
		const program = function* () {
			yield* log.tell(["a"]);
			const before = yield* log.peek();
			yield* log.tell(["b"]);

			return [before, yield* log.peek()] as const;
		};

		const [seen] = Eff.run(program, [log.handlers()]);

		expect(seen).toEqual([["a"], ["a", "b"]]);
	});

	it("answers listen with what the program alone wrote", () => {
		const program = function* () {
			yield* log.tell(["outer"]);
			const [value, written] = yield* log.listen(
				(function* () {
					yield* log.tell(["inner"]);

					return 7;
				})(),
			);

			return [value, written] as const;
		};

		const [seen] = Eff.run(program, [log.handlers()]);

		expect(seen).toEqual([7, ["inner"]]);
	});

	/* mtl's listen reports a subprogram's writes without withholding them. */
	it("still delivers a listened program's writes to the enclosing accumulator", () => {
		const program = function* () {
			yield* log.tell(["before"]);
			yield* log.listen(
				(function* () {
					yield* log.tell(["inner"]);
				})(),
			);
			yield* log.tell(["after"]);
		};

		const [, written] = Eff.run(program, [log.handlers()]);

		expect(written).toEqual(["before", "inner", "after"]);
	});

	it("scopes peek to the innermost listen", () => {
		const program = function* () {
			yield* log.tell(["outer"]);

			const [inner] = yield* log.listen(
				(function* () {
					yield* log.tell(["inner"]);

					return yield* log.peek();
				})(),
			);

			return [inner, yield* log.peek()] as const;
		};

		const [seen] = Eff.run(program, [log.handlers()]);

		/* The listened program sees only its own writes; afterwards they have joined the parent. */
		expect(seen).toEqual([["inner"], ["outer", "inner"]]);
	});

	it("nests listens", () => {
		const program = function* () {
			const [deep, middle] = yield* log.listen(
				(function* () {
					yield* log.tell(["m1"]);
					const [, inner] = yield* log.listen(
						(function* () {
							yield* log.tell(["d1"]);
						})(),
					);
					yield* log.tell(["m2"]);

					return inner;
				})(),
			);

			return [deep, middle] as const;
		};

		const [seen, written] = Eff.run(program, [log.handlers()]);

		/* The inner listen sees its own writes; the outer one sees those and its siblings'. */
		expect(seen).toEqual([["d1"], ["m1", "d1", "m2"]]);
		expect(written).toEqual(["m1", "d1", "m2"]);
	});

	it("censors a program's writes on their way out", () => {
		const program = function* () {
			yield* log.tell(["kept"]);
			const value = yield* log.censor(
				written => written.map(entry => entry.toUpperCase()),
				(function* () {
					yield* log.tell(["shout"]);

					return 1;
				})(),
			);

			return value;
		};

		const [value, written] = Eff.run(program, [log.handlers()]);

		expect(value).toBe(1);
		expect(written).toEqual(["kept", "SHOUT"]);
	});

	it("drops what a censor discards", () => {
		const program = function* () {
			yield* log.tell(["kept"]);
			yield* log.censor(
				() => [],
				(function* () {
					yield* log.tell(["dropped"]);
				})(),
			);
		};

		const [, written] = Eff.run(program, [log.handlers()]);

		expect(written).toEqual(["kept"]);
	});

	/*
	 * Held for the open question, not asserting current behaviour: an aborted listen
	 * contributes nothing while the run-level accumulator still reports its writes.
	 * Which answer is right is undecided — z-yap/zettels/scope-output-on-abort.md.
	 */
	it.skip("keeps what a listened program wrote when it aborts", () => {
		const program = function* () {
			yield* log.tell(["before"]);
			yield* log.listen(
				(function* () {
					yield* log.tell(["during"]);
					yield* fail.raise("stop");
				})(),
			);
			yield* log.tell(["unreachable"]);
		};

		const [answer, written] = Eff.run(program, [log.handlers(), fail.handlers()]);

		expect(Eff.failed(answer)).toBe(true);
		expect(written).toEqual(["before", "during"]);
	});
});
