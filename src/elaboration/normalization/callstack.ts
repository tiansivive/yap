/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state (stacks, marks); pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "./syntax/term";

/*
 * The NbE machine's stacks as an effect: one ambient machine per run, the
 * direct replacement of the old module-global work/result stacks. Every
 * evaluation entry is a marked drive on that same machine, so helpers that
 * re-enter evaluation (matching, apply) share it, and shift capture sees
 * delimiters across entries exactly as before.
 *
 * Environments are not machine state: the reader is the single env
 * authority. The scheduling ops snapshot the reader into the frame — the
 * defunctionalized reader of a CEK machine — and the driver re-binds the
 * reader per step; reader.local is the only way to schedule under another
 * scope. Only closure values own a context of their own.
 *
 * One instance module-wide: an action's identity is its tag.
 */

export type StackFrame =
	| { type: "Eval"; env: EB.Context; term: EB.Term; noInline: boolean }
	| { type: "Cont"; env: EB.Context; arity: number; k: (results: NF.Value[]) => Evaluation<void> }
	| { type: "Delimiter"; env: EB.Context; resultSize: number };

/** A shift-captured slice of the machine: the delimited continuation. */
export type Captured = { frames: StackFrame[]; results: NF.Value[]; env: EB.Context };

/** Where a drive began; next/finish never reach below it. */
export type Mark = { work: number; results: number };

/**
 * What the driver runs next, and under which env; the handler has already
 * taken the args. Delimiters never surface here — reached normally they are
 * a no-op, so next absorbs them; only capture consumes their payload.
 */
export type Step =
	| { type: "Eval"; env: EB.Context; term: EB.Term; noInline: boolean }
	| { type: "Cont"; env: EB.Context; k: (results: NF.Value[]) => Evaluation<void>; args: NF.Value[] };

type Begin = Eff.Action<"Callstack.begin", undefined, Mark>;
type Next = Eff.Action<"Callstack.next", Mark, Step | undefined>;
type Finish = Eff.Action<"Callstack.finish", Mark, NF.Value>;
type Eval = Eff.Action<"Callstack.eval", { env: EB.Context; term: EB.Term; noInline: boolean }, undefined>;
type Ret = Eff.Action<"Callstack.ret", NF.Value, undefined>;
type Cont = Eff.Action<"Callstack.cont", { env: EB.Context; arity: number; k: (results: NF.Value[]) => Evaluation<void> }, undefined>;
type Delimit = Eff.Action<"Callstack.delimit", EB.Context, undefined>;

type Delimited = Eff.Action<"Callstack.delimited", undefined, boolean>;
type Capture = Eff.Action<"Callstack.capture", undefined, Captured | undefined>;
type Resume = Eff.Action<"Callstack.resume", { captured: Captured; value: NF.Value }, undefined>;

/** Opens a drive: everything above the mark belongs to this evaluate call. */
const begin = function* () {
	return yield* Eff.ctl.action<Begin>("Callstack.begin", undefined);
};

/** The next step of this drive, or undefined when its work is exhausted. */
const next = function* (mark: Mark) {
	return yield* Eff.ctl.action<Next>("Callstack.next", mark);
};

/** Closes a drive: answers with its single result. */
const finish = function* (mark: Mark) {
	return yield* Eff.ctl.action<Finish>("Callstack.finish", mark);
};

/** Evaluate term next, under the environment the reader holds at scheduling time. */
const evalOp = function* (term: EB.Term, noInline = false) {
	const env = yield* M.reader.ask();

	return yield* Eff.ctl.action<Eval>("Callstack.eval", { env, term, noInline });
};

/** Return a finished value to the next continuation. */
const ret = function* (value: NF.Value) {
	return yield* Eff.ctl.action<Ret>("Callstack.ret", value);
};

/** Continuation: run k over the next `arity` results, under the scheduling-time environment. */
const cont = function* (arity: number, k: (results: NF.Value[]) => Evaluation<void>) {
	const env = yield* M.reader.ask();

	return yield* Eff.ctl.action<Cont>("Callstack.cont", { env, arity, k });
};

/** Marks a reset boundary for continuation capture. */
const delimit = function* () {
	const env = yield* M.reader.ask();

	return yield* Eff.ctl.action<Delimit>("Callstack.delimit", env);
};

/** Whether a reset boundary is in scope. */
const delimited = function* () {
	return yield* Eff.ctl.action<Delimited>("Callstack.delimited", undefined);
};

/** Slices off everything up to the nearest delimiter; undefined without one. */
const capture = function* () {
	return yield* Eff.ctl.action<Capture>("Callstack.capture", undefined);
};

/** Replays a captured continuation with value at the shift point. */
const resume = function* (captured: Captured, value: NF.Value) {
	return yield* Eff.ctl.action<Resume>("Callstack.resume", { captured, value });
};

type Actions = Begin | Next | Finish | Eval | Ret | Cont | Delimit | Delimited | Capture | Resume;

const handlers = (): Eff.Handler<Actions, undefined> => {
	/* This handler owns the machine; its clauses are the only way to move it. */
	const workStack: StackFrame[] = [];
	const resultStack: NF.Value[] = [];

	return {
		clauses: {
			"Callstack.begin": () => Eff.ctl.resume<Mark>({ work: workStack.length, results: resultStack.length }),

			"Callstack.next": mark => {
				while (workStack.length > mark.work) {
					const step = match<StackFrame, Step | undefined>(workStack.pop() as StackFrame)
						.with({ type: "Delimiter" }, () => undefined)
						.with({ type: "Eval" }, ({ env, term, noInline }) => ({ type: "Eval", env, term, noInline }))
						.with({ type: "Cont" }, ({ env, arity, k }) => {
							const args = resultStack.splice(-arity, arity);

							if (args.length !== arity) {
								throw new Error(`Continuation expected ${arity} results but got ${args.length}`);
							}

							return { type: "Cont", env, k, args };
						})
						.exhaustive();

					if (step) {
						return Eff.ctl.resume<Step | undefined>(step);
					}
				}

				return Eff.ctl.resume<Step | undefined>(undefined);
			},

			"Callstack.finish": mark => {
				const produced = resultStack.length - mark.results;

				if (produced !== 1) {
					throw new Error(`Expected exactly 1 result, got ${produced}`);
				}

				return Eff.ctl.resume(resultStack.pop() as NF.Value);
			},

			"Callstack.eval": ({ env, term, noInline }) => {
				workStack.push({ type: "Eval", env, term, noInline });

				return Eff.ctl.resume(undefined);
			},

			"Callstack.ret": value => {
				resultStack.push(value);

				return Eff.ctl.resume(undefined);
			},

			"Callstack.cont": ({ env, arity, k }) => {
				workStack.push({ type: "Cont", env, arity, k });

				return Eff.ctl.resume(undefined);
			},

			"Callstack.delimit": env => {
				workStack.push({ type: "Delimiter", env, resultSize: resultStack.length });

				return Eff.ctl.resume(undefined);
			},

			"Callstack.delimited": () => Eff.ctl.resume(workStack.some(frame => frame.type === "Delimiter")),

			"Callstack.capture": () => {
				const index = workStack.findLastIndex(frame => frame.type === "Delimiter");

				const captured = match<StackFrame | undefined, Captured | undefined>(workStack[index])
					.with({ type: "Delimiter" }, ({ env, resultSize }) => {
						const frames = workStack.slice(index + 1);
						const results = resultStack.slice(resultSize);

						/* Drop the delimiter and everything above it: the shift aborts the inner continuation. */
						workStack.splice(index);
						resultStack.splice(resultSize);

						return { frames, results, env };
					})
					.otherwise(() => undefined);

				return Eff.ctl.resume(captured);
			},

			"Callstack.resume": ({ captured, value }) => {
				resultStack.push(...captured.results, value);
				workStack.push(...captured.frames);

				return Eff.ctl.resume(undefined);
			},
		},

		output: () => undefined,
	};
};

export const callstack = { begin, next, finish, eval: evalOp, ret, cont, delimit, delimited, capture, resume, handlers };

/*
 * The machine's row: its own stacks, the metacontext for meta dereferencing,
 * and the reader as the single env authority. Spelled from the action union
 * rather than `typeof callstack` — the row is referenced from `cont`'s
 * continuation type, and going through the instance would make that
 * reference eagerly circular.
 */
export type Evaluation<A> = Eff.Eff<Actions | Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof M.reader>, A>;
