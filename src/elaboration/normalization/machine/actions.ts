/* eslint-disable @typescript-eslint/consistent-type-assertions -- scheduling answers later, so eval/cont/finish claim the type the frame will be given */
import * as Eff from "@yap/utils/effects";

import type * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import type * as NF from "../syntax/term";
import { Mode, type EvalMode, type Evaluation } from "../effects";
import type { Blame, Captured, Mark, Runnable } from "./frames";

/** Scheduling: what to run next, and the answer to hand back. */
export const Frame = { of, cont, eval: evalOp, step, group };

/** The machine itself: opening a drive, stepping it, and the delimited-control operations. */
export const Stack = { begin, next, finish, eval: evalOp, cont, delimit, delimited, capture, resume };

export type Actions = Begin | Next | Finish | Eval | Of | Cont | Delimit | Delimited | Capture | Resume;

type Begin = Eff.Action<"Machine.begin", Blame, Mark>;

/** Opens a drive: everything above the mark belongs to it, and a divergence inside it is blamed on `blame`. */
function* begin(blame: Blame) {
	return yield* Eff.ctl.action<Begin>("Machine.begin", blame);
}

type Next = Eff.Action<"Machine.next", Mark, Runnable | undefined>;

function* next(mark: Mark) {
	return yield* Eff.ctl.action<Next>("Machine.next", mark);
}

type Finish = Eff.Action<"Machine.finish", Mark, unknown>;

function* finish<A>(mark: Mark) {
	return (yield* Eff.ctl.action<Finish>("Machine.finish", mark)) as A;
}

type Eval = Eff.Action<"Machine.eval", { env: EB.Context; mode: EvalMode; term: EB.Term }, undefined>;

/** Evaluate term next, under the environment and mode the readers hold at scheduling time. */
function* evalOp(term: EB.Term): Evaluation<NF.Value> {
	const env = yield* M.reader.ask();
	const mode = yield* Mode.ask();

	yield* Eff.ctl.action<Eval>("Machine.eval", { env, mode, term });

	return undefined as unknown as NF.Value;
}

type Of = Eff.Action<"Machine.of", unknown, undefined>;

/** Answers the operation in progress, doing no work. */
function* of<T>(value: T): Evaluation<T> {
	yield* Eff.ctl.action<Of>("Machine.of", value);

	return value;
}

type Cont = Eff.Action<"Machine.cont", { env: EB.Context; mode: EvalMode; arity: number; k: (results: unknown[]) => Evaluation<unknown> }, undefined>;

/** Runs k over the next `arity` answers, under the scheduling-time environment; answers whatever k answers. */
function* cont<A = NF.Value, T = unknown>(arity: number, k: (answers: A[]) => Evaluation<T>): Evaluation<T> {
	const env = yield* M.reader.ask();
	const mode = yield* Mode.ask();

	yield* Eff.ctl.action<Cont>("Machine.cont", { env, mode, arity, k: k as (results: unknown[]) => Evaluation<unknown> });

	return undefined as unknown as T;
}

/** Schedules a group of works and continues with all their answers, in the order the group was written. */
function* group<A, T>(works: readonly Evaluation<A>[], k: (answers: A[]) => Evaluation<T>): Evaluation<T> {
	const answer = yield* cont(works.length, k);

	/* Back to front: the driver takes the last scheduled first. */
	yield* Eff.traverse(works.toReversed(), step);

	return answer;
}

/** Hands work back to the driver instead of calling it: what makes a recursive operation a run of steps. */
function* step<T>(work: Evaluation<T>): Evaluation<T> {
	return yield* cont(0, () => work);
}

type Delimit = Eff.Action<"Machine.delimit", EB.Context, undefined>;

function* delimit() {
	const env = yield* M.reader.ask();

	return yield* Eff.ctl.action<Delimit>("Machine.delimit", env);
}

type Delimited = Eff.Action<"Machine.delimited", undefined, boolean>;

function* delimited() {
	return yield* Eff.ctl.action<Delimited>("Machine.delimited", undefined);
}

type Capture = Eff.Action<"Machine.capture", undefined, Captured | undefined>;

/** Slices off everything up to the nearest delimiter; undefined without one. */
function* capture() {
	return yield* Eff.ctl.action<Capture>("Machine.capture", undefined);
}

type Resume = Eff.Action<"Machine.resume", { captured: Captured; value: unknown }, undefined>;

/** Replays a captured slice with the value at the shift point; it answers whatever the slice answers. */
function* resume<A = NF.Value>(captured: Captured, value: unknown): Evaluation<A> {
	yield* Eff.ctl.action<Resume>("Machine.resume", { captured, value });

	return undefined as unknown as A;
}
