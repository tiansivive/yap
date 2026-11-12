/* eslint-disable no-restricted-syntax  */
import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

import * as Stack from "../actions";
import type { Machine } from "../frames";
import { notation } from "../do";
import { handlers } from "../handlers";

type Program<A> = Eff.Eff<Stack.Actions<Env, Value>, A>;
type Env = Record<string, number>;
type Value = number | string;

const builtins: Env = { magic: 42, one: 1 };

const { step, group, Do } = notation<Env, Value, never>(function* () {
	return builtins;
});

const drive = function* <A>(work: Program<Machine<A>>): Program<A> {
	const mark = yield* Stack.begin(steps => `exhausted after ${steps} steps`);

	yield* work;

	const read = function* (scope: Env, control: Value): Program<Machine<number>> {
		if (typeof control === "number") {
			return yield* Stack.fill(control);
		}

		const bound = scope[control];

		if (bound === undefined) {
			throw new Error(`unknown builtin ${control}`);
		}

		return yield* Stack.fill(bound);
	};

	while (true) {
		const frame = yield* Stack.next<Env, Value>(mark);

		if (!frame) {
			break;
		}

		yield* frame.type === "Control" ? read(frame.scope, frame.control) : (frame.k(frame.operands) as Program<Machine<unknown>>);
	}

	return yield* Stack.finish<A>(mark);
};

const machine = <A>(work: Program<Machine<A>>, maxSteps = 1_000_000): A => {
	const [result] = Eff.run(() => drive(work), [handlers<Env, Value>(maxSteps)]);

	return result;
};

const evaluate = (control: Value) => Stack.push<number, Env, Value>(builtins, control);

describe("the machine, on its own", () => {
	describe("control", () => {
		it("hands a control frame to the driver and takes its result", () => {
			expect(machine(evaluate(1))).toBe(1);
		});

		it("hands the scope over with it, so a name resolves against the table", () => {
			expect(machine(evaluate("magic"))).toBe(42);
		});

		it("never reads the control itself: an unknown one is the driver's error, not the machine's", () => {
			expect(() => machine(evaluate("nonesuch"))).toThrow(/unknown builtin nonesuch/);
		});
	});

	describe("results", () => {
		it("hands back the drive's result", () => {
			expect(machine(Stack.fill("a string"))).toBe("a string");
		});

		it("carries any value, not just the ones a language happens to use", () => {
			const payload = { tag: "anything", nested: [1, { deep: true }] };

			expect(machine(Stack.fill(payload))).toBe(payload);
		});

		it("refuses a drive that produced two results", () => {
			const twice = function* (): Program<Machine<number>> {
				yield* Stack.fill(1);

				return yield* Stack.fill(2);
			};

			expect(() => machine(twice())).toThrow(/Expected exactly 1 result, got 2/);
		});

		it("refuses a continuation reached short of its operands", () => {
			expect(() => machine(Stack.cont(builtins, 2, ([a, b]: number[]) => Stack.fill(a + b)))).toThrow(/expected 2 operands but was given 0/);
		});
	});

	describe("groups", () => {
		it("hands the results over in the order the group was written", () => {
			const program = group([() => evaluate("one"), () => evaluate(2), () => evaluate(3)], parts => Stack.fill(parts.join("")));
			expect(machine(program)).toBe("123");
		});

		it("keeps that order when some works have a result at once and others take a step", () => {
			const later = (value: number) => step(() => Stack.fill(value));

			expect(machine(group([() => Stack.fill(1), () => later(2), () => evaluate(3)], parts => Stack.fill(parts.join(""))))).toBe("123");
		});

		it("names them, through the notation", () => {
			expect(
				machine(
					Do.let("a", () => evaluate("magic"))
						.let("b", () => evaluate(8))
						.in(({ a, b }) => Stack.fill(a + b)),
				),
			).toBe(50);
		});

		it("nests", () => {
			const inner = () => group([() => Stack.fill(1), () => Stack.fill(2)], ([a, b]) => Stack.fill(a + b));

			expect(machine(group([inner, () => Stack.fill(10)], ([sum, ten]) => Stack.fill(sum * ten)))).toBe(30);
		});
	});

	const countdown = function* (n: number): Program<Machine<number>> {
		return n === 0 ? yield* Stack.fill(0) : yield* step(() => countdown(n - 1));
	};
	describe("steps instead of calls", () => {
		it("runs a recursion far deeper than the host stack allows", () => {
			expect(machine(countdown(100_000))).toBe(0);
		});

		it("overflows the host stack when the same recursion delegates instead", () => {
			const recursive = function* (n: number): Program<Machine<number>> {
				return n === 0 ? yield* Stack.fill(0) : yield* recursive(n - 1);
			};

			expect(() => machine(recursive(100_000))).toThrow(RangeError);
		});
	});

	describe("fuel", () => {
		it("blames the drive that ran out", () => {
			expect(() => machine(countdown(100), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("charges a nested drive's steps to the same budget", () => {
			const nested = function* (): Program<Machine<number>> {
				return yield* Stack.fill(yield* drive(countdown(100)));
			};

			expect(() => machine(nested(), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("keeps a nested drive's result out of the drive around it", () => {
			const nested = function* (): Program<Machine<string>> {
				const inner = yield* drive(group([() => Stack.fill(1), () => Stack.fill(2)], ([a, b]) => Stack.fill(a + b)));

				return yield* Stack.fill(`inner produced ${inner}`);
			};

			expect(machine(nested())).toBe("inner produced 3");
		});
	});

	describe("evaluation entries", () => {
		const source = function* <A>(work: () => Program<Machine<A>>, scope = builtins): Program<Machine<A>> {
			yield* Stack.enter(scope);
			return yield* work();
		};
		const capture = function* () {
			return yield* Stack.fill(yield* Stack.capture<Env, Value>("entry"));
		};

		it("keeps the entry active while scheduled work executes", () => {
			const captured = machine(source(() => group<unknown, unknown[]>([() => evaluate(1), capture], ([a, b]) => Stack.fill([a, b]))));
			expect(captured).toMatchObject({ scope: builtins, frames: [{ type: "Cont", arity: 2, operands: [1] }] });
		});

		it("restores the outer entry after nested evaluation and a later sibling", () => {
			const nested = { nested: 1 };
			const program = source(() =>
				Do.let("first", () => source(capture, nested))
					.let("second", capture)
					.in(({ first, second }) => Stack.fill([first, second])),
			);
			const captured = machine(program);
			expect(captured).toMatchObject({ scope: builtins, frames: [{ type: "Cont", operands: [{ scope: nested, frames: [] }] }] });
		});

		it("expires equal-depth entries before executing sibling work", () => {
			const program = group([() => source(() => source(capture, { nested: 1 })), capture], parts => Stack.fill(parts));
			expect(machine(program)).toEqual([{ frames: [], scope: { nested: 1 }, entries: [] }, undefined]);
		});

		it("cleans an immediate result's entry at drive completion", () => {
			const program = function* (): Program<Machine<unknown>> {
				yield* drive(source(() => Stack.fill(1)));
				return yield* capture();
			};
			expect(machine(program())).toBeUndefined();
		});

		it.each(["immediate", "scheduled"])("restores the outer entry after a nested drive with %s work", kind => {
			const program = source(() =>
				step(function* () {
					yield* drive(source(() => (kind === "immediate" ? Stack.fill(1) : evaluate(1)), { nested: 1 }));
					return yield* capture();
				}),
			);
			expect(machine(program)).toEqual({ frames: [], scope: builtins, entries: [] });
		});

		it("restores equal-depth source entries when replaying a delimiter capture", () => {
			const program = function* () {
				yield* Stack.delimit(builtins);
				return yield* source(
					() =>
						source(
							() =>
								group(
									[
										function* () {
											return yield* Stack.fill(yield* Stack.capture<Env, Value>("delimiter"));
										},
										capture,
									],
									([, second]) => Stack.fill(second),
								),
							{ inner: 1 },
						),
					{ outer: 1 },
				);
			};
			const captured = machine(program())!;
			expect(captured.entries).toEqual([
				{ work: 0, scope: { outer: 1 } },
				{ work: 0, scope: { inner: 1 } },
			]);
			const replay = (argument: number) => machine(source(() => Stack.resume(captured, argument), { caller: 1 }));
			expect(replay(10)).toMatchObject({ scope: { inner: 1 }, frames: [{ type: "Cont", operands: [10] }] });
			expect(replay(20)).toMatchObject({ scope: { inner: 1 }, frames: [{ type: "Cont", operands: [20] }] });
		});

		it("keeps source delimiters visible through an evaluation entry", () => {
			const program = function* () {
				yield* Stack.delimit(builtins);
				return yield* source(
					function* () {
						return yield* step(function* () {
							return yield* Stack.fill(yield* Stack.capture<Env, Value>("delimiter"));
						});
					},
					{ nested: 1 },
				);
			};
			expect(machine(program())).toEqual({ frames: [], scope: builtins, entries: [{ work: 0, scope: { nested: 1 } }] });
		});
	});

	describe("delimited control", () => {
		it("finds the nearest delimiter, or nothing", () => {
			const nearest = function* (): Program<Machine<unknown>> {
				return yield* Stack.fill(yield* Stack.find<Env, Value>(frame => frame.type === "Delimiter"));
			};

			const delimited = function* (): Program<Machine<unknown>> {
				yield* Stack.delimit(builtins);

				return yield* nearest();
			};

			expect(machine(nearest())).toBeUndefined();
			expect(machine(delimited())).toEqual({ type: "Delimiter", scope: builtins });
		});

		it("gives every replay of a captured continuation its own operands", () => {
			const shift = function* (): Program<Machine<string>> {
				const captured = yield* Stack.capture<Env, Value>("delimiter");

				if (!captured) {
					throw new Error("shift without a delimiter");
				}

				return yield* group([() => Stack.resume<string, Env, Value>(captured, 10), () => Stack.resume<string, Env, Value>(captured, 20)], ([first, second]) =>
					Stack.fill(`${first} & ${second}`),
				);
			};

			const program = function* (): Program<Machine<string>> {
				yield* Stack.delimit(builtins);

				return yield* group<number | string, string>([() => Stack.fill(1), () => shift(), () => evaluate("magic")], ([a, b, c]) =>
					Stack.fill(`${a}+${b}+${c}`),
				);
			};

			expect(machine(program())).toBe("1+10+42 & 1+20+42");
		});
	});
});
