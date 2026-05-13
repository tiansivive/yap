import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as MIR from "../mir";
import * as M from "../monad";
import * as C from "../context";
import { freeVars, sortedNumbers } from "../shared/freevars";
import * as Closure from "./closures";

const { Instr } = MIR.Constructors;

export const lower = (formal: string, body: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();

		const indices = sortedNumbers(freeVars(body, 1));
		const captured = C.resolveCaptured(ctx, indices);

		// K-call guard. docs/MIR-LOWERING.md §8 Option B: escaping continuations not supported.
		const sbc = ctx.shiftBodyCtx;
		if (sbc) {
			for (const c of captured) {
				if (c.stamp === sbc.kRef.stamp) {
					return yield* M.fail<void>({
						tag: "NotImplemented",
						what: "Lambda captures continuation k (docs/MIR-LOWERING.md §8 Option B)",
					});
				}
			}
		}

		const readVars = indices.map(() => ctx.nextVar());
		const overrides = new Map(
			indices.map((idx, j) => {
				const rv = readVars[j];
				assert(rv);
				return [idx, rv] as const;
			}),
		);
		const formalStamped = C.stampNamed(formal);
		const fnName = ctx.nextVar("fn");
		const envParam = ctx.nextVar("env");
		const envReads: MIR.Instr[] = indices.map((_, j) => {
			const rv = readVars[j];
			assert(rv);
			return Instr.Read(`v${j}`, envParam.name, rv.name);
		});
		const lambdaEntry = `${fnName.name}_entry`;
		const innerCtx = C.bind(ctx, formalStamped, overrides);

		const outerFocus = yield* M.Focus.get();
		yield* M.Pending.open(lambdaEntry, [], envReads);

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					const pending = yield* M.Pending.peek(lambdaEntry);
					assert(pending, `lambda: pending block ${lambdaEntry} missing`);
					yield* M.State.modify(s => {
						const accumulated = new Map(s.accumulated);
						accumulated.delete(lambdaEntry);
						return { ...s, accumulated, focus: outerFocus };
					});

					const closureRef = yield* Closure.convert(ctx, fnName.name, [envParam.name, formal], { instrs: pending.instrs, result: bodyR }, captured);
					yield* M.Results.push({ tag: "value", value: closureRef });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term: body });
	});
