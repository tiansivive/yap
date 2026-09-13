/* eslint-disable no-restricted-syntax -- the driver loop is the trampoline; writing it recursively is the thing it exists to avoid */
import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

import type * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import { Frame, Stack } from "../actions";
import { handlers } from "../handlers";
import { Mode, defaultMode, type Evaluation } from "../../effects";

/*
 * The machine with no language in it. Nothing here is a term or a value: the works answer numbers,
 * strings and objects, and the driver runs continuations only, so an Eval frame would be a bug.
 */
const nowhere = {} as EB.Context;

const drive = function* <A>(work: Evaluation<A>): Evaluation<A> {
	const mark = yield* Stack.begin(steps => `exhausted after ${steps} steps`);

	yield* work;

	while (true) {
		const frame = yield* Stack.next(mark);

		if (!frame) {
			break;
		}

		if (frame.type !== "Cont") {
			throw new Error("this driver runs continuations only");
		}

		yield* frame.k(frame.operands);
	}

	return yield* Stack.finish<A>(mark);
};

const machine = <A>(work: Evaluation<A>, maxSteps = 1_000_000): A => {
	const [answer] = Eff.run(
		() => drive(work),
		[handlers(maxSteps), Mode.handlers(defaultMode), M.reader.handlers(nowhere), Metas.registry.handlers(Metas.empty)],
	);

	return answer;
};

const countdown = function* (n: number): Evaluation<number> {
	return n === 0 ? yield* Frame.of(0) : yield* Frame.step(countdown(n - 1));
};

describe("the machine, on its own", () => {
	describe("answers", () => {
		it("hands back whatever a drive answered with", () => {
			expect(machine(Frame.of(42))).toBe(42);
			expect(machine(Frame.of("a string"))).toBe("a string");
		});

		it("carries any value, not just the ones NbE happens to use", () => {
			const payload = { tag: "anything", nested: [1, { deep: true }] };

			expect(machine(Frame.of(payload))).toBe(payload);
		});

		it("refuses a drive that answered twice", () => {
			const twice = function* (): Evaluation<number> {
				yield* Frame.of(1);

				return yield* Frame.of(2);
			};

			expect(() => machine(twice())).toThrow(/Expected exactly 1 result, got 2/);
		});

		it("refuses a continuation reached short of its operands", () => {
			expect(() => machine(Frame.cont(2, ([a, b]: number[]) => Frame.of(a + b)))).toThrow(/expected 2 operands but was given 0/);
		});
	});

	describe("groups", () => {
		it("hands the answers over in the order the group was written", () => {
			expect(machine(Frame.group([Frame.of("a"), Frame.of("b"), Frame.of("c")], parts => Frame.of(parts.join(""))))).toBe("abc");
		});

		it("keeps that order when some works answer at once and others take a step", () => {
			const later = (value: string) => Frame.step(Frame.of(value));

			expect(machine(Frame.group([Frame.of("a"), later("b"), Frame.of("c")], parts => Frame.of(parts.join(""))))).toBe("abc");
		});

		it("nests", () => {
			const inner = Frame.group([Frame.of(1), Frame.of(2)], ([a, b]) => Frame.of(a + b));

			expect(machine(Frame.group([inner, Frame.of(10)], ([sum, ten]) => Frame.of(sum * ten)))).toBe(30);
		});
	});

	describe("steps instead of calls", () => {
		it("runs a recursion far deeper than the host stack allows", () => {
			expect(machine(countdown(100_000))).toBe(0);
		});

		it("overflows the host stack when the same recursion delegates instead", () => {
			const recursive = function* (n: number): Evaluation<number> {
				return n === 0 ? yield* Frame.of(0) : yield* recursive(n - 1);
			};

			expect(() => machine(recursive(100_000))).toThrow(RangeError);
		});
	});

	describe("fuel", () => {
		it("blames the drive that ran out", () => {
			expect(() => machine(countdown(100), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("charges a nested drive's steps to the same budget", () => {
			const nested = function* (): Evaluation<number> {
				return yield* drive(countdown(100));
			};

			expect(() => machine(nested(), 10)).toThrow(/exhausted after 10 steps/);
		});

		it("keeps a nested drive's answer out of the drive around it", () => {
			const nested = function* (): Evaluation<string> {
				const inner = yield* drive(Frame.group([Frame.of(1), Frame.of(2)], ([a, b]) => Frame.of(a + b)));

				return yield* Frame.of(`inner answered ${inner}`);
			};

			expect(machine(nested())).toBe("inner answered 3");
		});
	});

	describe("delimited control", () => {
		it("reports whether a delimiter is in scope", () => {
			const asked = function* (): Evaluation<boolean> {
				return yield* Frame.of(yield* Stack.delimited());
			};

			const delimited = function* (): Evaluation<boolean> {
				yield* Stack.delimit();

				return yield* asked();
			};

			expect(machine(asked())).toBe(false);
			expect(machine(delimited())).toBe(true);
		});

		it("gives every replay of a captured continuation its own operands", () => {
			const shift = function* (): Evaluation<string> {
				const captured = yield* Stack.capture();

				if (!captured) {
					throw new Error("shift without a delimiter");
				}

				return yield* Frame.group([Stack.resume<string>(captured, 10), Stack.resume<string>(captured, 20)], ([first, second]) =>
					Frame.of(`${first} & ${second}`),
				);
			};

			const program = function* (): Evaluation<string> {
				yield* Stack.delimit();

				return yield* Frame.group<number | string, string>([Frame.of(1), shift()], ([a, b]) => Frame.of(`${a}+${b}`));
			};

			expect(machine(program())).toBe("1+10 & 1+20");
		});
	});
});
