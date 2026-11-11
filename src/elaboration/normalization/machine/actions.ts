/* eslint-disable @typescript-eslint/consistent-type-assertions -- `finish` takes a real value off the slot, and a stored continuation's row is erased */
import * as Eff from "@yap/utils/effects";

import { scheduled, type Blame, type Captured, type Machine, type Mark, type Runnable, type StackFrame, type Stored } from "./frames";

export type Actions<S, C, D = undefined> =
	| Begin
	| Next<S, C, D>
	| Finish
	| Push<S, C>
	| Fill
	| Cont<S>
	| Delimit<S, D>
	| Find<S, C, D>
	| Capture<S, C, D>
	| Resume<S, C, D>;

type Begin = Eff.Action<"Machine.begin", Blame, Mark>;
export function* begin(blame: Blame) {
	return yield* Eff.ctl.action<Begin>("Machine.begin", blame);
}

type Next<S, C, D> = Eff.Action<"Machine.next", Mark, Runnable<S, C, D> | undefined>;
export function* next<S, C, D = undefined>(mark: Mark) {
	return yield* Eff.ctl.action<Next<S, C, D>>("Machine.next", mark);
}

type Finish = Eff.Action<"Machine.finish", Mark, unknown>;

export function* finish<V>(mark: Mark) {
	return (yield* Eff.ctl.action<Finish>("Machine.finish", mark)) as V;
}

type Push<S, C> = Eff.Action<"Machine.push", { scope: S; control: C }, undefined>;
export function* push<V, S, C>(scope: S, control: C): Eff.Eff<Push<S, C>, Machine<V>> {
	yield* Eff.ctl.action<Push<S, C>>("Machine.push", { scope, control });

	return scheduled;
}

type Fill = Eff.Action<"Machine.fill", unknown, undefined>;
export function* fill<V>(value: V): Eff.Eff<Fill, Machine<V>> {
	yield* Eff.ctl.action<Fill>("Machine.fill", value);

	return scheduled;
}

type Cont<S> = Eff.Action<"Machine.cont", { scope: S; arity: number; k: Stored }, undefined>;
export function* cont<A, T, R extends Eff.AnyAction, S>(scope: S, arity: number, k: (operands: A[]) => Eff.Eff<R, Machine<T>>): Eff.Eff<Cont<S>, Machine<T>> {
	yield* Eff.ctl.action<Cont<S>>("Machine.cont", { scope, arity, k: k as Stored });

	return scheduled;
}

type Delimit<S, D> = Eff.Action<"Machine.delimit", { scope: S; data?: D }, undefined>;
/** Marks a boundary a capture slices back to. */
export function* delimit<S, D = undefined>(scope: S, data?: D) {
	return yield* Eff.ctl.action<Delimit<S, D>>("Machine.delimit", { scope, data });
}

type Find<S, C, D> = Eff.Action<"Machine.find", (frame: StackFrame<S, C, D>) => boolean, StackFrame<S, C, D> | undefined>;
export function* find<S, C, D = undefined>(match: (frame: StackFrame<S, C, D>) => boolean) {
	return yield* Eff.ctl.action<Find<S, C, D>>("Machine.find", match);
}

type Capture<S, C, D> = Eff.Action<"Machine.capture", (data: D | undefined) => boolean, Captured<S, C, D> | undefined>;
export function* capture<S, C, D = undefined>(matches: (data: D | undefined) => boolean = () => true) {
	return yield* Eff.ctl.action<Capture<S, C, D>>("Machine.capture", matches);
}

type Resume<S, C, D> = Eff.Action<"Machine.resume", { captured: Captured<S, C, D>; value: unknown }, undefined>;
export function* resume<V, S, C, D = undefined>(captured: Captured<S, C, D>, value: unknown): Eff.Eff<Resume<S, C, D>, Machine<V>> {
	yield* Eff.ctl.action<Resume<S, C, D>>("Machine.resume", { captured, value });

	return scheduled;
}
