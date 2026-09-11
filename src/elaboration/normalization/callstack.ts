/* eslint-disable no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- the handler owns the machine state (stacks, marks); pops narrow via assertion */
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "./syntax/term";

/*
 * Evaluation mode flags — a separate reader channel so evaluation options
 * don't pollute the context/env reader. Namespaced to avoid tag collision.
 */
export type EvalMode = {
	/** no δ-reduction: prevents inlining of let-bound definitions. */
	noInlineBindings: boolean;
	/** no ι-reduction: prevents reducing eliminations (projections, matches) on known values. */
	noReduceEliminations: boolean;
};

export const defaultMode: EvalMode = { noInlineBindings: false, noReduceEliminations: false };
export const Mode = Eff.reader<EvalMode, "EvalMode">("EvalMode");

/*
 * The NbE machine's stacks as an effect: one ambient machine per run, the
 * direct replacement of the old module-global work/result stacks. Every
 * evaluation entry is a marked drive on that same machine, so helpers that
 * re-enter evaluation (matching, apply) share it, and shift capture sees
 * delimiters across entries exactly as before.
 *
 * Environments and evaluation modes are not machine state: the readers are
 * the single authority for both. The scheduling ops snapshot them into the
 * frame — the defunctionalized reader of a CEK machine — and the driver
 * re-binds them per step; reader.local and Mode.local are the only ways to
 * schedule under another scope. Only closure values own a context of their
 * own.
 *
 * One instance module-wide: an action's identity is its tag.
 */

export type StackFrame =
	| { type: "Eval"; env: EB.Context; mode: EvalMode; term: EB.Term }
	| { type: "Cont"; env: EB.Context; mode: EvalMode; arity: number; k: (results: unknown[]) => Evaluation<void> }
	| { type: "Delimiter"; env: EB.Context; resultSize: number };

/** A shift-captured slice of the machine: the delimited continuation. */
export type Captured = { frames: StackFrame[]; results: NF.Value[]; env: EB.Context };

/*
 * Most operations answer with a value, and those go on the result stack raw: the result path is
 * hot and a wrapper per step would be pure overhead. The few that answer otherwise — a pattern
 * observation, a projection verdict — ride tagged, so the machine can tell at a glance whether a
 * pending answer is a value. `next` strips the tag before handing results to a continuation; only
 * `capture`, which has to reason about what a continuation closure can carry, reads it.
 */
const ANSWER = Symbol("Callstack.answer");

type Tagged = { [ANSWER]: string; value: unknown };

const isTagged = (result: unknown): result is Tagged => typeof result === "object" && result !== null && ANSWER in result;

const payload = (result: unknown): unknown => (isTagged(result) ? result.value : result);

/** Where a drive began; next/finish never reach below it. */
export type Mark = { work: number; results: number };

/**
 * What the driver runs next, and under which env; the handler has already
 * taken the args. Delimiters never surface here — reached normally they are
 * a no-op, so next absorbs them; only capture consumes their payload.
 */
export type Step =
	| { type: "Eval"; env: EB.Context; mode: EvalMode; term: EB.Term }
	| { type: "Cont"; env: EB.Context; mode: EvalMode; k: (results: unknown[]) => Evaluation<void>; args: unknown[] };

/**
 * A step, and how many the machine has taken including it. Fuel is the machine's:
 * a drive that spends its budget inside a nested drive has still spent it, so the
 * count rides along with the step rather than accumulating per driver loop.
 */
export type Progress = Step & { spent: number };

type Begin = Eff.Action<"Callstack.begin", undefined, Mark>;
type Next = Eff.Action<"Callstack.next", Mark, Progress | undefined>;
type Finish = Eff.Action<"Callstack.finish", Mark, unknown>;
type Eval = Eff.Action<"Callstack.eval", { env: EB.Context; mode: EvalMode; term: EB.Term }, undefined>;
type Ret = Eff.Action<"Callstack.ret", NF.Value, undefined>;
type Answer = Eff.Action<"Callstack.answer", Tagged, undefined>;
type Cont = Eff.Action<"Callstack.cont", { env: EB.Context; mode: EvalMode; arity: number; k: (results: unknown[]) => Evaluation<void> }, undefined>;
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

/** Closes a drive: answers with its single result, which the drive's caller knows the shape of. */
const finish = function* <A = NF.Value>(mark: Mark) {
	return (yield* Eff.ctl.action<Finish>("Callstack.finish", mark)) as A;
};

/** Evaluate term next, under the environment and mode the readers hold at scheduling time. */
const evalOp = function* (term: EB.Term) {
	const env = yield* M.reader.ask();
	const mode = yield* Mode.ask();

	return yield* Eff.ctl.action<Eval>("Callstack.eval", { env, mode, term });
};

/** Return a finished value to the next continuation. */
const ret = function* (value: NF.Value) {
	return yield* Eff.ctl.action<Ret>("Callstack.ret", value);
};

/** Return a finished answer that is not a value: it rides tagged so `capture` can recognise it. */
const answer = function* <A>(kind: string, value: A) {
	return yield* Eff.ctl.action<Answer>("Callstack.answer", { [ANSWER]: kind, value });
};

/**
 * Continuation: run k over the next `arity` answers, under the scheduling-time environment.
 * What a frame consumes is the frame's own business, so the stored form forgets it and `A`
 * defaults to `NF.Value`, which is what every frame but the observation ones expects.
 */
const cont = function* <A = NF.Value>(arity: number, k: (results: A[]) => Evaluation<void>) {
	const env = yield* M.reader.ask();
	const mode = yield* Mode.ask();

	return yield* Eff.ctl.action<Cont>("Callstack.cont", { env, mode, arity, k: k as (results: unknown[]) => Evaluation<void> });
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

type Actions = Begin | Next | Finish | Eval | Ret | Answer | Cont | Delimit | Delimited | Capture | Resume;

const handlers = (): Eff.Handler<Actions, undefined> => {
	/* This handler owns the machine; its clauses are the only way to move it. */
	const workStack: StackFrame[] = [];
	const resultStack: unknown[] = [];
	/* Fuel spent by this machine, across every drive on it — absorbing a delimiter is not a step. */
	let spent = 0;

	return {
		clauses: {
			"Callstack.begin": () => Eff.ctl.resume<Mark>({ work: workStack.length, results: resultStack.length }),

			"Callstack.next": mark => {
				while (workStack.length > mark.work) {
					const step = match<StackFrame, Step | undefined>(workStack.pop() as StackFrame)
						.with({ type: "Delimiter" }, () => undefined)
						.with({ type: "Eval" }, ({ env, mode, term }) => ({ type: "Eval", env, mode, term }))
						.with({ type: "Cont" }, ({ env, mode, arity, k }) => {
							const args = resultStack.splice(-arity, arity).map(payload);

							if (args.length !== arity) {
								throw new Error(`Continuation expected ${arity} results but got ${args.length}`);
							}

							return { type: "Cont", env, mode, k, args };
						})
						.exhaustive();

					if (step) {
						spent++;

						return Eff.ctl.resume<Progress | undefined>({ ...step, spent });
					}
				}

				return Eff.ctl.resume<Progress | undefined>(undefined);
			},

			"Callstack.finish": mark => {
				const produced = resultStack.length - mark.results;

				if (produced !== 1) {
					throw new Error(`Expected exactly 1 result, got ${produced}`);
				}

				return Eff.ctl.resume(payload(resultStack.pop()));
			},

			"Callstack.eval": ({ env, mode, term }) => {
				workStack.push({ type: "Eval", env, mode, term });

				return Eff.ctl.resume(undefined);
			},

			"Callstack.ret": value => {
				resultStack.push(value);

				return Eff.ctl.resume(undefined);
			},

			"Callstack.answer": tagged => {
				resultStack.push(tagged);

				return Eff.ctl.resume(undefined);
			},

			"Callstack.cont": ({ env, mode, arity, k }) => {
				workStack.push({ type: "Cont", env, mode, arity, k });

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
						const pending = results.filter(isTagged);

						/*
						 * A shift fired while an operation answering with something other than a value was
						 * partway done, as in matching a pattern against a field that is itself a shift.
						 *
						 * Replaying such a slice is well defined in the machine: the frame and the answer it
						 * expects travel together, and resume pushes both back in order. What has no home is
						 * the captured slice itself, because a continuation closure is an NF.Value whose
						 * results are values, so a pending observation cannot be stored in one.
						 *
						 * Making it legal means widening Captured.results and NF.Closure's Continuation to
						 * the machine's answer type, which is a value carrying machine-internal state either
						 * way — it already stores StackFrame[]. Until a program needs it, refusing loudly
						 * beats a silent mis-replay.
						 */
						if (pending.length > 0) {
							const kinds = [...new Set(pending.map(entry => entry[ANSWER]))].join(", ");

							throw new Error(
								`Cannot capture a continuation while a ${kinds} is in flight. The delimited slice holds an answer that is not a value, ` +
									`and a continuation closure can only carry values. This happens when a shift is reached from inside an operation that ` +
									`answers with a verdict rather than a value — a pattern observation or a projection — and it is unimplemented, not invalid.`,
							);
						}

						/* Drop the delimiter and everything above it: the shift aborts the inner continuation. */
						workStack.splice(index);
						resultStack.splice(resultSize);

						return { frames, results: results as NF.Value[], env };
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

export const callstack = { begin, next, finish, eval: evalOp, ret, answer, cont, delimit, delimited, capture, resume, handlers };

/*
 * The machine's row: its own stacks, the metacontext for meta dereferencing,
 * the reader as the single env authority, and the evalMode reader for
 * normalization flags. Spelled from the action union rather than `typeof
 * callstack` — the row is referenced from `cont`'s continuation type, and
 * going through the instance would make that reference eagerly circular.
 */
export type Evaluation<A> = Eff.Eff<Actions | Eff.Only<typeof Metas.registry, "Registry.get"> | Eff.Actions<typeof M.reader> | Eff.Actions<typeof Mode>, A>;
