import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as MIR from "../mir";
import * as M from "../monad";
import * as C from "../context";

const { Instr, Terminator: T } = MIR.Constructors;

export const lower = (body: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const rc = ctx.resetCtx;
		if (rc === undefined) {
			return yield* M.fail<void>({ tag: "ShiftWithoutReset" });
		}
		if (body.type !== "Abs" || body.binding.type !== "Lambda") {
			return yield* M.fail<void>({ tag: "InvalidShiftBody", got: body.type });
		}
		const kBinder = body.binding.variable;
		const shiftBody = body.body;

		const state = yield* M.State.get();
		const di = state.worklist.findLastIndex(f => f.type === "Delimiter");
		if (di < 0) {
			return yield* M.fail<void>({ tag: "ShiftWithoutReset" });
		}
		const delim = state.worklist[di] as Extract<M.Frame, { type: "Delimiter" }>;
		const capturedFrames = state.worklist.slice(di + 1);
		const capturedResults = state.results.slice(delim.resultSize);

		const captures: Array<{ label: string; target: string }> = Array.from(ctx.bound.values()).map((s, j) => ({
			label: `v${j}`,
			target: s.name,
		}));

		const rLabel = ctx.nextLabel("r");
		const v_param = ctx.nextVar();
		const r_envParam = ctx.nextVar("env");
		const idx_param = ctx.nextVar("i");
		const envRef = ctx.nextVar("env");
		const kRef = ctx.nextVar("k");
		const sInit = ctx.nextLabel("s");
		const kP = ctx.nextVar("k");

		const sbc: C.ShiftBodyCtx = {
			rLabel,
			kRef,
			envRef,
			nextKCallIdx: 0,
			kResultNames: [],
			resetExit: rc.resetExit,
			captures,
			sLabels: [],
		};

		const outerFocus = state.focus;
		if (outerFocus === undefined) {
			throw new Error("Shift: no focused pending block");
		}

		const envFields = captures.map(c => ({ label: c.label, value: c.target }));
		yield* M.Pending.appendMany([
			Instr.Alloc({ type: "Record", fields: envFields }, envRef.name),
			Instr.Alloc({ type: "Record", fields: [{ label: "__env", value: envRef.name }] }, kRef.name),
		]);
		yield* M.Pending.finalize(outerFocus, T.Jump(sInit, [kRef.name]));

		const rCaptureReads = captures.map(c => Instr.Read(c.label, r_envParam.name, c.target));
		yield* M.Pending.open(rLabel, [v_param.name, r_envParam.name, idx_param.name], rCaptureReads);

		const innerCtx: C.LowerCtx = {
			...C.bind(ctx, C.stampNamed(kBinder), new Map([[0, kRef]])),
			shiftBodyCtx: sbc,
		};

		const restHolder: { result?: M.ValueResult } = {};

		const bridgeCont: M.Frame = {
			type: "Cont",
			arity: 1,
			handler: ([restR]) =>
				M.Do(function* () {
					assert(restR);
					restHolder.result = restR;
					const sInitCaptureReads = captures.map(c => Instr.Read(c.label, envRef.name, c.target));
					yield* M.Pending.open(sInit, [kP.name], [Instr.Read("__env", kP.name, envRef.name), ...sInitCaptureReads]);
				}),
		};

		const assembleCont: M.Frame = {
			type: "Cont",
			arity: 1,
			handler: ([bodyResult]) =>
				M.Do(function* () {
					assert(bodyResult);
					const finalFocus = yield* M.Focus.get();
					assert(finalFocus, "Shift assembly: no focused pending block");
					yield* M.Pending.finalize(finalFocus, T.Jump(rc.resetExit, [bodyResult.value.name]));

					if (sbc.nextKCallIdx > 0) {
						const { result } = restHolder;
						assert(result, "Shift assembly: no rest result");
						const cases = sbc.sLabels.map((label, i) => ({
							value: String(i),
							target: label,
							args: [result.value.name, r_envParam.name],
						}));
						yield* M.Pending.finalize(rLabel, T.Branch(idx_param.name, cases));
					} else {
						yield* M.State.modify(s => {
							const m = new Map(s.accumulated);
							m.delete(rLabel);
							return { ...s, accumulated: m, focus: s.focus === rLabel ? undefined : s.focus };
						});
					}

					const exitParam = ctx.nextVar();
					yield* M.Pending.open(rc.resetExit, [exitParam.name]);
					yield* M.Pending.finalize(rc.resetExit, T.Return(exitParam.name));

					yield* M.Results.push({ tag: "value", value: { stamp: -1, name: "" } as C.Stamped });
				}),
		};

		yield* M.State.modify(s => ({
			...s,
			worklist: s.worklist.slice(0, di),
			results: s.results.slice(0, delim.resultSize),
		}));

		yield* M.Worklist.push(assembleCont);
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term: shiftBody });
		yield* M.Worklist.push(bridgeCont);
		for (const f of capturedFrames) {
			yield* M.Worklist.push(f);
		}

		for (const r of capturedResults) {
			yield* M.Results.push(r);
		}
		yield* M.Results.push({ tag: "value", value: v_param });
	});
