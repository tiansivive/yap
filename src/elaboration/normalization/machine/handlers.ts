/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state; pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import type { Actions } from "./actions";
import type { Captured, Mark, Runnable, StackFrame } from "./frames";

export const handlers = <S, C>(maxSteps: number): Eff.Handler<Actions<S, C>, undefined> => {
	const workStack: StackFrame<S, C>[] = [];
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

			"Machine.delimit": scope => {
				workStack.push({ type: "Delimiter", scope });

				return Eff.ctl.resume(undefined);
			},

			"Machine.enter": scope => {
				entries.push({ work: workStack.length, scope });
				return Eff.ctl.resume(undefined);
			},

			"Machine.find": ({ match, extent }) => {
				const start = extent === "entry" ? (entries.at(-1)?.work ?? 0) : 0;
				return Eff.ctl.resume(workStack.findLast((frame, index) => index >= start && match(frame)));
			},

			"Machine.capture": extent => {
				const entry = match(extent)
					.with("entry", () => entries.pop())
					.with("delimiter", () => {
						const work = workStack.findLastIndex(frame => frame.type === "Delimiter");
						return match(workStack[work])
							.with({ type: "Delimiter" }, ({ scope }) => ({ work, scope }))
							.otherwise(() => undefined);
					})
					.exhaustive();

				if (!entry) {
					return Eff.ctl.resume<Captured<S, C> | undefined>(undefined);
				}

				const start = entry.work + (extent === "delimiter" ? 1 : 0);
				const captured = {
					frames: workStack.slice(start),
					scope: entry.scope,
					entries: extent === "delimiter" ? entries.filter(entry => entry.work >= start).map(({ work, scope }) => ({ work: work - start, scope })) : [],
				};
				rewind(entry.work);
				return Eff.ctl.resume<Captured<S, C> | undefined>(captured);
			},

			"Machine.resume": ({ captured, value }) => {
				// Copying the captured frames to the work stack preserves the original continuation structure in each resumption.
				const start = workStack.length;
				entries.push(...captured.entries.map(({ work, scope }) => ({ work: start + work, scope })));
				workStack.push(...captured.frames.map(frame => ("operands" in frame ? { ...frame, operands: [...frame.operands] } : frame)));
				fill(value);

				return Eff.ctl.resume(undefined);
			},
		},

		output: () => undefined,
	};
};

const runnable = <S, C>(frame: StackFrame<S, C>): frame is Runnable<S, C> => frame.type === "Control" || frame.type === "Cont";
