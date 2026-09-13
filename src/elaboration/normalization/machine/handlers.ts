/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state; pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import type { Actions } from "./actions";
import type { Captured, Mark, Runnable, StackFrame } from "./frames";

export const handlers = (maxSteps: number): Eff.Handler<Actions, undefined> => {
	const workStack: StackFrame[] = [];
	let spent = 0;

	const slot = (mark: Mark) => {
		const frame = workStack[mark.work - 1];

		if (frame?.type !== "Result") {
			throw new Error("The machine lost the drive it was running");
		}

		return frame;
	};

	const fill = (value: unknown) => {
		const index = workStack.findLastIndex(frame => frame.type === "Result" || (frame.type === "Cont" && frame.operands.length < frame.arity));

		if (index < 0) {
			throw new Error("An operation answered with no frame waiting for it");
		}

		(workStack[index] as { operands: unknown[] }).operands.push(value);
	};

	return {
		clauses: {
			"Machine.begin": blame => {
				workStack.push({ type: "Result", operands: [], blame });

				return Eff.ctl.resume<Mark>({ work: workStack.length });
			},

			"Machine.next": mark => {
				const index = workStack.findLastIndex(runnable);
				const frame = index >= mark.work ? (workStack[index] as Runnable) : undefined;

				workStack.length = Math.max(index, mark.work);

				if (!frame) {
					return Eff.ctl.resume<Runnable | undefined>(undefined);
				}

				if (frame.type === "Cont" && frame.operands.length !== frame.arity) {
					throw new Error(`Continuation expected ${frame.arity} operands but was given ${frame.operands.length}`);
				}

				spent++;

				if (spent > maxSteps) {
					throw new Error(slot(mark).blame(maxSteps));
				}

				return Eff.ctl.resume<Runnable | undefined>(frame);
			},

			"Machine.finish": mark => {
				const drive = slot(mark);

				if (drive.operands.length !== 1) {
					throw new Error(`Expected exactly 1 result, got ${drive.operands.length}`);
				}

				workStack.length = mark.work - 1;

				return Eff.ctl.resume(drive.operands[0]);
			},

			"Machine.eval": ({ env, mode, term }) => {
				workStack.push({ type: "Eval", env, mode, term });

				return Eff.ctl.resume(undefined);
			},

			"Machine.of": value => {
				fill(value);

				return Eff.ctl.resume(undefined);
			},

			"Machine.cont": ({ env, mode, arity, k }) => {
				workStack.push({ type: "Cont", env, mode, arity, operands: [], k });

				return Eff.ctl.resume(undefined);
			},

			"Machine.delimit": env => {
				workStack.push({ type: "Delimiter", env });

				return Eff.ctl.resume(undefined);
			},

			"Machine.delimited": () => Eff.ctl.resume(workStack.some(frame => frame.type === "Delimiter")),

			"Machine.capture": () => {
				const index = workStack.findLastIndex(frame => frame.type === "Delimiter");

				const captured = match<StackFrame | undefined, Captured | undefined>(workStack[index])
					.with({ type: "Delimiter" }, ({ env }) => {
						const frames = workStack.slice(index + 1);

						/* The shift aborts the inner continuation: drop the delimiter and everything above it. */
						workStack.splice(index);

						return { frames, env };
					})
					.otherwise(() => undefined);

				return Eff.ctl.resume(captured);
			},

			"Machine.resume": ({ captured, value }) => {
				/* One capture, many applications: each takes its own operands. */
				workStack.push(...captured.frames.map(frame => ("operands" in frame ? { ...frame, operands: [...frame.operands] } : frame)));
				fill(value);

				return Eff.ctl.resume(undefined);
			},
		},

		output: () => undefined,
	};
};

const runnable = (frame: StackFrame): frame is Runnable => frame.type === "Eval" || frame.type === "Cont";
