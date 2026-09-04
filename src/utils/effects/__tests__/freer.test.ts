import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

const state = Eff.st<number>();
const errors = Eff.except<string>();

describe("Eff.with", () => {
	it("answers covered actions locally and returns the handler's output", () => {
		const program = function* () {
			yield* state.put(1);
			yield* state.modify(n => n + 41);

			return yield* state.get();
		};

		const scoped = function* () {
			const [value, cell] = yield* Eff.with([state.handlers(0)], program);

			return [value, cell] as const;
		};

		const [result] = Eff.run(scoped, []);

		expect(result).toEqual([42, 42]);
	});

	it("forwards uncovered actions to the enclosing run", () => {
		const counter = Eff.supply<"tick">();

		const program = function* () {
			const inner = yield* Eff.with([state.handlers(10)], function* () {
				const first = yield* counter.fresh("tick");
				yield* state.put(first);

				return yield* state.get();
			});

			const outer = yield* counter.fresh("tick");

			return [inner[0], outer] as const;
		};

		const [result] = Eff.run(program, [counter.handlers()]);

		/* The counter is shared with the enclosing run; the state cell is not. */
		expect(result).toEqual([1, 2]);
	});

	it("keeps a covered effect private per scope", () => {
		const program = function* () {
			const [first] = yield* Eff.with([state.handlers(0)], function* () {
				yield* state.put(7);

				return yield* state.get();
			});

			const [second] = yield* Eff.with([state.handlers(0)], function* () {
				return yield* state.get();
			});

			return [first, second] as const;
		};

		const [result] = Eff.run(program, []);

		expect(result).toEqual([7, 0]);
	});

	it("shadows the enclosing run's handler for covered tags", () => {
		const program = function* () {
			const ambient = yield* state.get();
			const [shadowed] = yield* Eff.with([state.handlers(100)], function* () {
				return yield* state.get();
			});
			const after = yield* state.get();

			return [ambient, shadowed, after] as const;
		};

		const [result] = Eff.run(program, [state.handlers(1)]);

		expect(result).toEqual([1, 100, 1]);
	});

	it("forwards an abort to the enclosing run", () => {
		const program = function* () {
			const [value] = yield* Eff.with([state.handlers(0)], function* () {
				yield* state.put(5);

				return yield* errors.raise("boom");
			});

			return value;
		};

		const [answer] = Eff.run(program, [errors.handlers()]);

		expect(Eff.failed(answer)).toBe(true);
	});

	it("a with-installed raise clause delimits at the with", () => {
		const catching: Eff.Handler<Eff.Actions<typeof errors>, undefined, string> = {
			clauses: { "Except.raise": error => Eff.ctl.abort(`caught: ${String(error)}`) },
			output: () => undefined,
		};

		const program = function* () {
			const [attempt] = yield* Eff.with([catching], function* () {
				yield* errors.raise("boom");

				return "unreachable";
			});

			/* The abort answered the with; the program carries on past it. */
			return Eff.failed(attempt) ? attempt[Eff.ABORT] : attempt;
		};

		const [answer] = Eff.run(program, [errors.handlers()]);

		expect(Eff.failed(answer)).toBe(false);
		expect(answer).toBe("caught: boom");
	});

	it("tries candidates by delimiting each attempt", () => {
		const attempted: Eff.Handler<Eff.Actions<typeof errors>, undefined, string> = {
			clauses: { "Except.raise": error => Eff.ctl.abort(String(error)) },
			output: () => undefined,
		};

		const attempt = (candidate: number) =>
			Eff.with([attempted], function* () {
				yield* state.put(candidate);

				if (candidate < 3) {
					return yield* errors.raise(`no: ${candidate}`);
				}

				return candidate;
			});

		const search = function* (candidates: readonly number[]): Eff.Eff<Eff.Actions<[typeof errors, typeof state]>, number> {
			if (candidates.length === 0) {
				return yield* errors.raise("exhausted");
			}

			const [candidate, ...rest] = candidates;
			const [outcome] = yield* attempt(candidate);

			return Eff.failed(outcome) ? yield* search(rest) : outcome;
		};

		const program = () => search([1, 2, 3]);

		const [answer] = Eff.run(program, [errors.handlers(), state.handlers(0)]);

		expect(answer).toBe(3);
	});
});
