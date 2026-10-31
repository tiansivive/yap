/* eslint-disable @typescript-eslint/consistent-type-assertions -- `finish` takes a real value off the slot, and a stored continuation's row is erased */
import * as Eff from "@yap/utils/effects";

import { scheduled, type Blame, type Captured, type Delimiter, type Machine, type Mark, type Runnable, type StackFrame, type Stored } from "./frames";

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

type Delimit<S> = Eff.Action<"Machine.delimit", Delimiter<S>, undefined>;
/** Marks a boundary a capture slices back to. */
export function* delimit<S>(scope: S, identity?: string, handler?: unknown) {
	return yield* Eff.ctl.action<Delimit<S>>("Machine.delimit", {
		type: "Delimiter",
		scope,
		...(identity === undefined ? {} : { identity }),
		...(handler === undefined ? {} : { handler }),
	});
}

type Find<S, C> = Eff.Action<"Machine.find", (frame: StackFrame<S, C>) => boolean, StackFrame<S, C> | undefined>;
export function* find<S, C>(match: (frame: StackFrame<S, C>) => boolean) {
	return yield* Eff.ctl.action<Find<S, C>>("Machine.find", match);
}

type Capture<S, C> = Eff.Action<"Machine.capture", string | undefined, Captured<S, C> | undefined>;
export function* capture<S, C>(identity?: string) {
	return yield* Eff.ctl.action<Capture<S, C>>("Machine.capture", identity);
}

type Resume<S, C> = Eff.Action<"Machine.resume", { captured: Captured<S, C>; value: unknown; deep: boolean }, undefined>;
export function* resume<V, S, C>(captured: Captured<S, C>, value: unknown, deep = false): Eff.Eff<Resume<S, C>, Machine<V>> {
	yield* Eff.ctl.action<Resume<S, C>>("Machine.resume", { captured, value, deep });

	return scheduled;
}
