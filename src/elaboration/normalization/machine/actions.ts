/* eslint-disable @typescript-eslint/consistent-type-assertions -- a scheduled frame produces its result later, so push/cont/resume/finish claim the type it will be given */
import * as Eff from "@yap/utils/effects";

import type { Blame, Captured, Mark, Runnable, StackFrame, Stored } from "./frames";

export type Actions<S, C> = Begin | Next<S, C> | Finish | Push<S, C> | Fill | Cont<S> | Delimit<S> | Find<S, C> | Capture<S, C> | Resume<S, C>;

type Begin = Eff.Action<"Machine.begin", Blame, Mark>;
export function* begin(blame: Blame) {
	return yield* Eff.ctl.action<Begin>("Machine.begin", blame);
}

type Next<S, C> = Eff.Action<"Machine.next", Mark, Runnable<S, C> | undefined>;
export function* next<S, C>(mark: Mark) {
	return yield* Eff.ctl.action<Next<S, C>>("Machine.next", mark);
}

type Finish = Eff.Action<"Machine.finish", Mark, unknown>;

export function* finish<V>(mark: Mark) {
	return (yield* Eff.ctl.action<Finish>("Machine.finish", mark)) as V;
}

type Push<S, C> = Eff.Action<"Machine.push", { scope: S; control: C }, undefined>;
export function* push<V, S, C>(scope: S, control: C): Eff.Eff<Push<S, C>, V> {
	yield* Eff.ctl.action<Push<S, C>>("Machine.push", { scope, control });

	return undefined as V; // We cast so typing works
}

type Fill = Eff.Action<"Machine.fill", unknown, undefined>;
export function* fill<V>(value: V): Eff.Eff<Fill, V> {
	yield* Eff.ctl.action<Fill>("Machine.fill", value);

	return value;
}

type Cont<S> = Eff.Action<"Machine.cont", { scope: S; arity: number; k: Stored }, undefined>;
export function* cont<A, T, R extends Eff.AnyAction, S>(scope: S, arity: number, k: (operands: A[]) => Eff.Eff<R, T>): Eff.Eff<Cont<S>, T> {
	yield* Eff.ctl.action<Cont<S>>("Machine.cont", { scope, arity, k: k as Stored });

	return undefined as T;
}

type Delimit<S> = Eff.Action<"Machine.delimit", S, undefined>;
/** Marks a boundary a capture slices back to. */
export function* delimit<S>(scope: S) {
	return yield* Eff.ctl.action<Delimit<S>>("Machine.delimit", scope);
}

type Find<S, C> = Eff.Action<"Machine.find", (frame: StackFrame<S, C>) => boolean, StackFrame<S, C> | undefined>;
export function* find<S, C>(match: (frame: StackFrame<S, C>) => boolean) {
	return yield* Eff.ctl.action<Find<S, C>>("Machine.find", match);
}

type Capture<S, C> = Eff.Action<"Machine.capture", undefined, Captured<S, C> | undefined>;
export function* capture<S, C>() {
	return yield* Eff.ctl.action<Capture<S, C>>("Machine.capture", undefined);
}

type Resume<S, C> = Eff.Action<"Machine.resume", { captured: Captured<S, C>; value: unknown }, undefined>;
export function* resume<V, S, C>(captured: Captured<S, C>, value: unknown): Eff.Eff<Resume<S, C>, V> {
	yield* Eff.ctl.action<Resume<S, C>>("Machine.resume", { captured, value });

	return undefined as V;
}
