/* eslint-disable no-restricted-syntax -- the handler owns the window stack; its clauses are the only way to move it */
import * as Eff from "@yap/utils/effects";

/*
 * Frame lifetime is the scoping: a window at level L opens under a stack of length L and nested
 * windows open under deeper stacks, so within one scope stacked levels strictly increase and a
 * record matches at most one frame. Levels reused by sibling scopes cannot collide because the
 * dead window's frame is gone. Recording against a level with no open window is deliberately a
 * no-op — that is how a reference to an already-closed scope is ignored.
 *
 * Windows are keyed by scope as well as level because a Nu frame lives on the label stack, not the
 * env: a field window and its enclosing let window can share a level number.
 */

type Key = { scope: "env" | "local"; lvl: number };

type Push = Eff.Action<"Recursion.push", Key, undefined>;
type Record = Eff.Action<"Recursion.record", { key: Key; item: unknown }, undefined>;
type Pop<T> = Eff.Action<"Recursion.pop", undefined, T[]>;

/** The item type is supplied first because TypeScript cannot infer `Row` and `A` once any argument is explicit. */
const within = <T>() =>
	function* <Row extends Eff.AnyAction, A>(key: Key, program: () => Eff.Eff<Row, A>) {
		yield* Eff.ctl.action<Push>("Recursion.push", key);

		const value = yield* program();

		const items = yield* Eff.ctl.action<Pop<T>>("Recursion.pop", undefined);

		return [value, items] as const;
	};

const record = function* (key: Key, item: unknown) {
	return yield* Eff.ctl.action<Record>("Recursion.record", { key, item });
};

type Frame = { key: Key; items: unknown[] };

const handlers = (): Eff.Handler<Push | Record | Pop<unknown>, readonly Frame[]> => {
	const frames: Frame[] = [];

	return {
		clauses: {
			"Recursion.push": key => {
				frames.push({ key, items: [] });

				return Eff.ctl.resume(undefined);
			},

			"Recursion.record": ({ key, item }) => {
				frames.find(f => f.key.scope === key.scope && f.key.lvl === key.lvl)?.items.push(item);

				return Eff.ctl.resume(undefined);
			},

			"Recursion.pop": () => Eff.ctl.resume(frames.pop()?.items ?? []),
		},

		/* Empty after a completed run; whatever was open when an abort stopped it. */
		output: () => [...frames],
	};
};

export const windows = { record, within };

/** The item is unit, so only its presence carries meaning. */
export const recursion = {
	flag: function* (lvl: number) {
		return yield* record({ scope: "env", lvl }, undefined);
	},
	detect: function* <Row extends Eff.AnyAction, A>(lvl: number, program: () => Eff.Eff<Row, A>) {
		const [value, items] = yield* within<unknown>()({ scope: "env", lvl }, program);

		return [value, items.length > 0] as const;
	},
	handlers,
};
