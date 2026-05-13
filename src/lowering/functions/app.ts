import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as MIR from "../mir";
import * as M from "../monad";
import { call as emitCall } from "./materialize";

const { Instr } = MIR.Constructors;

export const lower = (func: EB.Term, arg: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();

		yield* M.Worklist.push({
			type: "Cont:sat",
			arity: 2,
			saturate: new Set([0]),
			handler: ([funcR, argR]) =>
				M.Do(function* () {
					assert(funcR);
					assert(argR);
					assert(argR.tag === "value");
					const argVal = argR.value;
					yield match(funcR)
						.with({ tag: "foreign" }, { tag: "primop" }, pending => {
							return M.Do(function* () {
								const saturated = { ...pending, args: [...pending.args, argVal] };
								const next = saturated.args.length === saturated.arity ? yield* emitCall(ctx, saturated) : saturated;
								yield* M.Results.push(next);
							});
						})
						.with({ tag: "value" }, vr => {
							return M.Do(function* () {
								const fnVar = ctx.nextVar("fnref");
								const envVar = ctx.nextVar("env");
								const result = ctx.nextVar();
								yield* M.Pending.appendMany([
									Instr.Read("__fn", vr.value.name, fnVar.name),
									Instr.Read("__env", vr.value.name, envVar.name),
									Instr.Call({ type: "indirect", callee: fnVar.name }, [envVar.name, argVal.name], result.name),
								]);
								yield* M.Results.push({ tag: "value", value: result });
							});
						})
						.exhaustive();
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: arg });
		yield* M.Worklist.push({ type: "Lower", ctx, term: func });
	});
