/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state; pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import type { Actions } from "./actions";
import type { Mark, Runnable, StackFrame } from "./frames";

export const handlers = <S, C, D = unknown>(maxSteps: number): Eff.Handler<Actions<S, C, D>, undefined> => {
	const workStack: StackFrame<S, C, D>[] = [];
	/* Scheduled work keeps its entry until the driver unwinds below its saved depth. */
	const entries: (Mark & { scope: S })[] = [];
	let spent = 0;

	const rewind = (work: number) => {
		workStack.length = work;
		entries.length = entries.findLastIndex(entry => entry.work <= work) + 1;
	};

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
			throw new Error("An operation produced a result with no frame waiting for it");
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
				const frame = index >= mark.work ? (workStack[index] as Runnable<S, C>) : undefined;

				rewind(Math.max(index, mark.work));

				if (!frame) {
					return Eff.ctl.resume<Runnable<S, C> | undefined>(undefined);
				}

				if (frame.type === "Cont" && frame.operands.length !== frame.arity) {
					throw new Error(`Continuation expected ${frame.arity} operands but was given ${frame.operands.length}`);
				}

				spent++;

				if (spent > maxSteps) {
					throw new Error(slot(mark).blame(maxSteps));
				}

				return Eff.ctl.resume<Runnable<S, C> | undefined>(frame);
			},

			"Machine.finish": mark => {
				const drive = slot(mark);

				if (drive.operands.length !== 1) {
					throw new Error(`Expected exactly 1 result, got ${drive.operands.length}`);
				}

				rewind(mark.work - 1);

				return Eff.ctl.resume(drive.operands[0]);
			},

			"Machine.push": ({ scope, control }) => {
				workStack.push({ type: "Control", scope, control });

				return Eff.ctl.resume(undefined);
			},

			"Machine.fill": value => {
				fill(value);

				return Eff.ctl.resume(undefined);
			},

			"Machine.cont": ({ scope, arity, k }) => {
				workStack.push({ type: "Cont", scope, arity, operands: [], k });

				return Eff.ctl.resume(undefined);
			},

			"Machine.delimit": ({ scope, handling }) => {
				workStack.push({ type: "Delimiter", scope, handling });

				return Eff.ctl.resume(undefined);
			},

			"Machine.enter": scope => {
				entries.push({ work: workStack.length, scope });
				return Eff.ctl.resume(undefined);
			},

			"Machine.find": match => Eff.ctl.resume(workStack.findLast(match)),

			"Machine.capture": accepts => {
				const entry = entries.at(-1);
				const work = workStack.findLastIndex(
					(frame, index) => index >= (entry?.work ?? 0) && frame.type === "Delimiter" && (!accepts || accepts(frame.handling)),
				);
				const stop = match(workStack[work])
					.with({ type: "Delimiter" }, ({ scope, handling }) => ({ type: "Delimiter" as const, work, start: work + 1, scope, handling }))
					.otherwise(() => {
						const fallback = entries.pop();
						return fallback && { type: "Entry" as const, ...fallback, start: fallback.work };
					});

				if (!stop) {
					return Eff.ctl.resume(undefined);
				}

				const captured = { frames: workStack.slice(stop.start), scope: stop.scope };
				rewind(stop.work);
				return match(stop)
					.with({ type: "Delimiter" }, ({ type, handling }) => Eff.ctl.resume({ type, captured, handling }))
					.with({ type: "Entry" }, ({ type }) => Eff.ctl.resume({ type, captured }))
					.exhaustive();
			},

			"Machine.resume": ({ captured, value }) => {
				// Copying the captured frames to the work stack preserves the original continuation structure in each resumption.
				workStack.push(...captured.frames.map(frame => ("operands" in frame ? { ...frame, operands: [...frame.operands] } : frame)));
				fill(value);

				return Eff.ctl.resume(undefined);
			},
		},

		output: () => undefined,
	};
};

const runnable = <S, C>(frame: StackFrame<S, C>): frame is Runnable<S, C> => frame.type === "Control" || frame.type === "Cont";
