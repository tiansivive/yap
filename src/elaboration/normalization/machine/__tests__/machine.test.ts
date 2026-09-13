/* eslint-disable no-restricted-syntax  */
import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

import * as Machine from "../actions";
import { notation } from "../do";
import { handlers } from "../handlers";

type Program<A> = Eff.Eff<Machine.Actions<Env, Value>, A>;
type Env = Record<string, number>;
type Value = number | string;

const builtins: Env = { magic: 42, one: 1 };

const { step, group, Do } = notation<Env, Value, never>(function* () {
	return builtins;
});

const drive = function* <A>(work: Program<A>): Program<A> {
	const mark = yield* Machine.begin(steps => `exhausted after ${steps} steps`);

	yield* work;

	const read = function* (scope: Env, control: Value): Program<number> {
		if (typeof control === "number") {
			return yield* Machine.fill(control);
		}

		const bound = scope[control];

		if (bound === undefined) {
			throw new Error(`unknown builtin ${control}`);
		}

		return yield* Machine.fill(bound);
	};

	while (true) {
		const frame = yield* Machine.next<Env, Value>(mark);

		if (!frame) {
			break;
		}

		yield* frame.type === "Control" ? read(frame.scope, frame.control) : (frame.k(frame.operands) as Program<unknown>);
	}

	return yield* Machine.finish<A>(mark);
};

const machine = <A>(work: Program<A>, maxSteps = 1_000_000): A => {
	const [result] = Eff.run(() => drive(work), [handlers<Env, Value>(maxSteps)]);

	return result;
};

const evaluate = (control: Value) => Machine.push<number, Env, Value>(builtins, control);

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
			expect(machine(Machine.fill("a string"))).toBe("a string");
		});

		it("carries any value, not just the ones a language happens to use", () => {
			const payload = { tag: "anything", nested: [1, { deep: true }] };

			expect(machine(Machine.fill(payload))).toBe(payload);
		});

		it("refuses a drive that produced two results", () => {
			const twice = function* (): Program<number> {
				yield* Machine.fill(1);

				return yield* Machine.fill(2);
			};

			expect(() => machine(twice())).toThrow(/Expected exactly 1 result, got 2/);
		});

		it("refuses a continuation reached short of its operands", () => {
			expect(() => machine(Machine.cont(builtins, 2, ([a, b]: number[]) => Machine.fill(a + b)))).toThrow(/expected 2 operands but was given 0/);
		});
	});

	describe("groups", () => {
		it("hands the results over in the order the group was written", () => {
			const program = group([evaluate("one"), evaluate(2), evaluate(3)], parts => Machine.fill(parts.join("")));
			expect(machine(program)).toBe("123");
		});

		it("keeps that order when some works have a result at once and others take a step", () => {
			const later = (value: number) => step(Machine.fill(value));

			expect(machine(group([Machine.fill(1), later(2), evaluate(3)], parts => Machine.fill(parts.join(""))))).toBe("123");
		});

		it("names them, through the notation", () => {
			expect(
				machine(
					Do.let("a", evaluate("magic"))
						.let("b", evaluate(8))
						.in(({ a, b }) => Machine.fill(a + b)),
				),
			).toBe(50);
		});

		it("nests", () => {
			const inner = group([Machine.fill(1), Machine.fill(2)], ([a, b]) => Machine.fill(a + b));

			expect(machine(group([inner, Machine.fill(10)], ([sum, ten]) => Machine.fill(sum * ten)))).toBe(30);
		});
	});

	const countdown = function* (n: number): Program<number> {
		return n === 0 ? yield* Machine.fill(0) : yield* step(countdown(n - 1));
	};
	describe("steps instead of calls", () => {
		it("runs a recursion far deeper than the host stack allows", () => {
			expect(machine(countdown(100_000))).toBe(0);
		});

		it("overflows the host stack when the same recursion delegates instead", () => {
			const recursive = function* (n: number): Program<number> {
				return n === 0 ? yield* Machine.fill(0) : yield* recursive(n - 1);
			};

			expect(() => machine(recursive(100_000))).toThrow(RangeError);
		});
	});

	describe("fuel", () => {
		it("blames the drive that ran out", () => {
			expect(() => machine(countdown(100), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("charges a nested drive's steps to the same budget", () => {
			const nested = function* (): Program<number> {
				return yield* drive(countdown(100));
			};

			expect(() => machine(nested(), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("keeps a nested drive's result out of the drive around it", () => {
			const nested = function* (): Program<string> {
				const inner = yield* drive(group([Machine.fill(1), Machine.fill(2)], ([a, b]) => Machine.fill(a + b)));

				return yield* Machine.fill(`inner produced ${inner}`);
			};

			expect(machine(nested())).toBe("inner produced 3");
		});
	});

	describe("delimited control", () => {
		it("finds the nearest delimiter, or nothing", () => {
			const nearest = function* (): Program<unknown> {
				return yield* Machine.fill(yield* Machine.find<Env, Value>(frame => frame.type === "Delimiter"));
			};

			const delimited = function* (): Program<unknown> {
				yield* Machine.delimit(builtins);

				return yield* nearest();
			};

			expect(machine(nearest())).toBeUndefined();
			expect(machine(delimited())).toEqual({ type: "Delimiter", scope: builtins });
		});

		it("gives every replay of a captured continuation its own operands", () => {
			const shift = function* (): Program<string> {
				const captured = yield* Machine.capture<Env, Value>();

				if (!captured) {
					throw new Error("shift without a delimiter");
				}

				return yield* group([Machine.resume<string, Env, Value>(captured, 10), Machine.resume<string, Env, Value>(captured, 20)], ([first, second]) =>
					Machine.fill(`${first} & ${second}`),
				);
			};

			const program = function* (): Program<string> {
				yield* Machine.delimit(builtins);

				return yield* group<number | string, string>([Machine.fill(1), shift()], ([a, b]) => Machine.fill(`${a}+${b}`));
			};

			expect(machine(program())).toBe("1+10 & 1+20");
		});
	});
});
