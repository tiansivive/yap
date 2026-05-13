import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as MIR from "../mir";
import * as M from "../monad";
import type * as C from "../context";

const { Instr, Expr: E, Terminator: T } = MIR.Constructors;

export const lower = (ctx: C.LowerCtx, sbc: C.ShiftBodyCtx, arg: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const idx = sbc.nextKCallIdx++;
		const idxVar = ctx.nextVar("i");
		const kr = ctx.nextVar();

		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([argResult]) =>
				M.Do(function* () {
					assert(argResult);
					yield* M.Pending.append(Instr.Let(idxVar.name, E.Lit(Lit.Num(idx))));
					const focus = yield* M.Focus.get();
					assert(focus, "kCall: no focused pending block");
					yield* M.Pending.finalize(focus, T.Jump(sbc.rLabel, [argResult.value.name, sbc.envRef.name, idxVar.name]));

					const sLabel = ctx.nextLabel("s");
					const v = ctx.nextVar();
					const envIn = ctx.nextVar("env");
					const envOut = ctx.nextVar("env");
					sbc.kResultNames.push({ idx, name: kr.name });
					sbc.sLabels.push(sLabel);

					const stashInstrs: MIR.Instr[] = [
						Instr.UpdateImmutable(envIn.name, envOut.name, {
							type: "Record",
							fields: [{ label: `r${idx}`, value: v.name }],
						}),
						...sbc.kResultNames.map(({ idx: i, name }) => Instr.Read(`r${i}`, envOut.name, name)),
						...sbc.captures.map(c => Instr.Read(c.label, envOut.name, c.target)),
					];
					yield* M.Pending.open(sLabel, [v.name, envIn.name], stashInstrs);
					sbc.envRef = envOut;

					yield* M.Results.push({ tag: "value", value: kr });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: arg });
	});
