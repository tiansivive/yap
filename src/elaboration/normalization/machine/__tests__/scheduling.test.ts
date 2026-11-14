import { describe, expect, it, vi } from "vitest";
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as Stack from "../actions";
import { notation } from "../do";
import type { Machine } from "../frames";
import { handlers } from "../handlers";

type Scope = { env: string; mode: string };
const Scope = Eff.reader<Scope>();
const Trace = Eff.writer<readonly string[]>({ empty: [], concat: (a, b) => [...a, ...b] });
type Ambient = Eff.Actions<typeof Scope> | Eff.Actions<typeof Trace>;
type Program<A> = Eff.Eff<Ambient | Stack.Actions<Scope, number>, A>;

const outer: Scope = { env: "outer", mode: "full" };
const fuel = 1_000;
const { Do, step, group } = notation<Scope, number, Ambient>(Scope.ask);

const machine = <A>(work: Program<Machine<A>>) => {
	const program = function* (): Program<A> {
		const mark = yield* Stack.begin(steps => `exhausted after ${steps} steps`);
		yield* work;

		// eslint-disable-next-line no-restricted-syntax -- The test driver runs scheduled frames to completion.
		while (true) {
			const frame = yield* Stack.next<Scope, number>(mark);

			if (!frame) {
				break;
			}

			yield* Scope.local(
				() => frame.scope,
				match(frame)
					.with({ type: "Control" }, ({ control }) => Stack.fill(control))
					.with({ type: "Cont" }, ({ k, operands }) => k(operands) as Program<Machine<unknown>>)
					.exhaustive(),
			);
		}

		return yield* Stack.finish<A>(mark);
	};
	const [value, , , trace] = Eff.run(program, [handlers<Scope, number>(fuel), Scope.handlers(outer), Trace.handlers()]);

	return { value, trace };
};

const evaluate = function* (value: number): Program<Machine<number>> {
	// eslint-disable-next-line no-restricted-syntax -- Stack.push schedules a control frame.
	return yield* Stack.push<number, Scope, number>(yield* Scope.ask(), value);
};

const record = function* <A>(label: string, work: Program<Machine<A>>): Program<Machine<A>> {
	yield* Trace.tell([label]);
	return yield* work;
};

describe("dependent scheduling", () => {
	it("runs an empty chain's body with empty bindings during the drive", () => {
		const body = vi.fn((bindings: Record<never, never>) => Stack.fill(bindings));
		const program = Do.in(body);

		expect(body).toHaveBeenCalledTimes(0);
		expect(machine(program).value).toEqual({});
		expect(body).toHaveBeenCalledExactlyOnceWith({});
	});

	it("starts with a dependent step and passes its result to the next step", () => {
		const program = Do.bind("first", bindings => Stack.fill({ bindings, value: 3 }))
			.bind("second", ({ first }) => evaluate(first.value * 2))
			.in(({ first, second }) => Stack.fill({ first, second }));

		expect(machine(program).value).toEqual({ first: { bindings: {}, value: 3 }, second: 6 });
	});

	it("preserves source order and prior results across mixed independent and dependent steps", () => {
		const program = Do.let("a", () => record("a", Stack.fill(2)))
			.let("b", () => record("b", evaluate(3)))
			.bind("sum", ({ a, b }) => record("sum", evaluate(a + b)))
			.let("label", () =>
				record(
					"label",
					step(() => Stack.fill("total")),
				),
			)
			.bind("answer", ({ a, b, sum, label }) => record("answer", Stack.fill(`${label}: ${a} + ${b} = ${sum}`)))
			.in(({ answer }) => record("body", Stack.fill(answer)));

		expect(machine(program)).toEqual({ value: "total: 2 + 3 = 5", trace: ["a", "b", "sum", "label", "answer", "body"] });
	});

	it("restores the chain's scope after a dependency schedules work in another scope", () => {
		const inner: Scope = { env: "inner", mode: "whnf" };
		const read = function* () {
			return yield* Stack.fill(yield* Scope.ask());
		};
		const program = Do.bind("inner", () => Scope.local(() => inner, step(read)))
			.bind("outer", read)
			.in(function* (bindings) {
				return yield* Stack.fill({ ...bindings, body: yield* Scope.ask() });
			});

		expect(machine(program).value).toEqual({ inner, outer, body: outer });
	});

	it("reuses a chain with independent binding results for each run", () => {
		const chain = Do.let("seed", () => evaluate(4)).bind("doubled", ({ seed }) => evaluate(seed * 2));

		expect(machine(chain.in(({ doubled }) => Stack.fill(doubled))).value).toBe(8);
		expect(machine(chain.bind("next", ({ seed, doubled }) => evaluate(seed + doubled)).in(Stack.fill)).value).toEqual({ seed: 4, doubled: 8, next: 12 });
		expect(machine(chain.in(Stack.fill)).value).toEqual({ seed: 4, doubled: 8 });
	});

	it("uses each resumed dependency's value in the remaining chain", () => {
		const suspend = function* (): Program<Machine<number>> {
			const captured = (yield* Stack.capture<Scope, number>())?.captured;

			expect(captured).toBeDefined();
			return yield* group([() => Stack.resume<number, Scope, number>(captured!, 10), () => Stack.resume<number, Scope, number>(captured!, 20)], ([a, b]) =>
				Stack.fill(a + b),
			);
		};
		const program = function* (): Program<Machine<number>> {
			yield* Stack.delimit(outer);
			return yield* Do.let("seed", () => Stack.fill(1))
				.bind("resumed", suspend)
				.bind("sum", ({ seed, resumed }) => evaluate(seed + resumed))
				.in(({ sum }) => Stack.fill(sum));
		};

		expect(machine(program()).value).toBe(32);
	});
});
