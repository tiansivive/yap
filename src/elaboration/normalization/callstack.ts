/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state (stacks, env register, marks); pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from ".";

/*
 * The NbE machine's state as an effect: the work stack, the result stack,
 * and the current environment all live in this handler. Evaluation code
 * says what to run and under which scope; the handler keeps the books.
 *
 * Environments on frames are the machine's defunctionalized reader — the E
 * of a CEK machine. They are not semantic capture, which is why they stay
 * inside the handler: only closure values carry a context of their own.
 *
 * One instance module-wide: an action's identity is its tag.
 */

export type StackFrame =
	| { type: "Eval"; env: EB.Context; term: EB.Term; noInline: boolean }
	| { type: "Cont"; arity: number; k: (results: NF.Value[]) => Evaluation<void> }
	| { type: "Delimiter"; env: EB.Context; resultSize: number };

/** A shift-captured slice of the machine: the delimited continuation. */
export type Captured = { frames: StackFrame[]; results: NF.Value[]; env: EB.Context };

/** Where a drive began; next/finish never reach below it. */
export type Mark = { work: number; results: number };

/**
 * What the driver runs next; the handler has already swapped env / taken args.
 * Delimiters never surface here — reached normally they are a no-op, so next
 * absorbs them; only capture consumes their payload.
 */
export type Step = { type: "Eval"; term: EB.Term; noInline: boolean } | { type: "Cont"; k: (results: NF.Value[]) => Evaluation<void>; args: NF.Value[] };

type Current = Eff.Action<"Callstack.current", undefined, EB.Context>;
type Begin = Eff.Action<"Callstack.begin", undefined, Mark>;
type Next = Eff.Action<"Callstack.next", Mark, Step | undefined>;
type Finish = Eff.Action<"Callstack.finish", Mark, NF.Value>;
type Eval = Eff.Action<"Callstack.eval", { term: EB.Term; noInline: boolean }, undefined>;
type With = Eff.Action<"Callstack.with", { env: EB.Context; term: EB.Term; noInline: boolean }, undefined>;
type Ret = Eff.Action<"Callstack.ret", NF.Value, undefined>;
type Cont = Eff.Action<"Callstack.cont", { arity: number; k: (results: NF.Value[]) => Evaluation<void> }, undefined>;
type Delimit = Eff.Action<"Callstack.delimit", undefined, undefined>;
type Delimited = Eff.Action<"Callstack.delimited", undefined, boolean>;
type Capture = Eff.Action<"Callstack.capture", undefined, Captured | undefined>;
type Resume = Eff.Action<"Callstack.resume", { captured: Captured; value: NF.Value }, undefined>;

/** The environment the machine is running under right now. */
const current = function* () {
	return yield* Eff.ctl.resume<Current>("Callstack.current", undefined);
};

/** Opens a drive: everything above the mark belongs to this evaluate call. */
const begin = function* () {
	return yield* Eff.ctl.resume<Begin>("Callstack.begin", undefined);
};

/** The next step of this drive, or undefined when its work is exhausted. */
const next = function* (mark: Mark) {
	return yield* Eff.ctl.resume<Next>("Callstack.next", mark);
};

/** Closes a drive: answers with its single result. */
const finish = function* (mark: Mark) {
	return yield* Eff.ctl.resume<Finish>("Callstack.finish", mark);
};

/** Evaluate term next, under the environment current at scheduling time. */
const evalOp = function* (term: EB.Term, noInline = false) {
	return yield* Eff.ctl.resume<Eval>("Callstack.eval", { term, noInline });
};

/** Evaluate term next, under the given environment — binder entry, closure consumption. */
const withOp = function* (env: EB.Context, term: EB.Term, noInline = false) {
	return yield* Eff.ctl.resume<With>("Callstack.with", { env, term, noInline });
};

/** Return a finished value to the next continuation. */
const ret = function* (value: NF.Value) {
	return yield* Eff.ctl.resume<Ret>("Callstack.ret", value);
};

/** Continuation: run k over the next `arity` results. */
const cont = function* (arity: number, k: (results: NF.Value[]) => Evaluation<void>) {
	return yield* Eff.ctl.resume<Cont>("Callstack.cont", { arity, k });
};

/** Marks a reset boundary for continuation capture. */
const delimit = function* () {
	return yield* Eff.ctl.resume<Delimit>("Callstack.delimit", undefined);
};

/** Whether a reset boundary is in scope. */
const delimited = function* () {
	return yield* Eff.ctl.resume<Delimited>("Callstack.delimited", undefined);
};

/** Slices off everything up to the nearest delimiter; undefined without one. */
const capture = function* () {
	return yield* Eff.ctl.resume<Capture>("Callstack.capture", undefined);
};

/** Replays a captured continuation with value at the shift point. */
const resume = function* (captured: Captured, value: NF.Value) {
	return yield* Eff.ctl.resume<Resume>("Callstack.resume", { captured, value });
};

type Actions = Current | Begin | Next | Finish | Eval | With | Ret | Cont | Delimit | Delimited | Capture | Resume;

const handlers = (entry: EB.Context): Eff.Handler<Actions, undefined> => {
	/* This handler owns the machine; its clauses are the only way to move it. */
	const workStack: StackFrame[] = [];
	const resultStack: NF.Value[] = [];
	let env = entry;

	return {
		clauses: {
			"Callstack.current": () => env,

			"Callstack.begin": (): Mark => ({ work: workStack.length, results: resultStack.length }),

			"Callstack.next": (mark): Step | undefined => {
				while (workStack.length > mark.work) {
					const step = match<StackFrame, Step | undefined>(workStack.pop() as StackFrame)
						.with({ type: "Delimiter" }, () => undefined)
						.with({ type: "Eval" }, ({ env: scope, term, noInline }) => {
							env = scope;

							return { type: "Eval", term, noInline };
						})
						.with({ type: "Cont" }, ({ arity, k }) => {
							const args = resultStack.splice(-arity, arity);

							if (args.length !== arity) {
								throw new Error(`Continuation expected ${arity} results but got ${args.length}`);
							}

							return { type: "Cont", k, args };
						})
						.exhaustive();

					if (step) {
						return step;
					}
				}

				return undefined;
			},

			"Callstack.finish": (mark): NF.Value => {
				const produced = resultStack.length - mark.results;

				if (produced !== 1) {
					throw new Error(`Expected exactly 1 result, got ${produced}`);
				}

				return resultStack.pop() as NF.Value;
			},

			"Callstack.eval": ({ term, noInline }) => {
				workStack.push({ type: "Eval", env, term, noInline });

				return undefined;
			},

			"Callstack.with": ({ env: scope, term, noInline }) => {
				workStack.push({ type: "Eval", env: scope, term, noInline });

				return undefined;
			},

			"Callstack.ret": value => {
				resultStack.push(value);

				return undefined;
			},

			"Callstack.cont": ({ arity, k }) => {
				workStack.push({ type: "Cont", arity, k });

				return undefined;
			},

			"Callstack.delimit": () => {
				workStack.push({ type: "Delimiter", env, resultSize: resultStack.length });

				return undefined;
			},

			"Callstack.delimited": () => workStack.some(frame => frame.type === "Delimiter"),

			"Callstack.capture": (): Captured | undefined => {
				const index = workStack.findLastIndex(frame => frame.type === "Delimiter");

				return match(workStack[index])
					.with({ type: "Delimiter" }, ({ env: scope, resultSize }) => {
						const frames = workStack.slice(index + 1);
						const results = resultStack.slice(resultSize);

						/* Drop the delimiter and everything above it: the shift aborts the inner continuation. */
						workStack.splice(index);
						resultStack.splice(resultSize);

						return { frames, results, env: scope };
					})
					.otherwise(() => undefined);
			},

			"Callstack.resume": ({ captured, value }) => {
				resultStack.push(...captured.results, value);
				workStack.push(...captured.frames);

				return undefined;
			},
		},

		output: () => undefined,
	};
};

export const callstack = { current, begin, next, finish, eval: evalOp, with: withOp, ret, cont, delimit, delimited, capture, resume, handlers };

/*
 * The machine's row: its own state plus the metacontext for meta dereferencing.
 * Spelled from the action union rather than `typeof callstack` — the row is
 * referenced from `after`'s continuation type, and going through the instance
 * would make that reference eagerly circular.
 */
export type Evaluation<A> = Eff.Eff<Actions | Eff.Actions<typeof Metas.registry>, A>;
