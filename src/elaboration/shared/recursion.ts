/* eslint-disable no-restricted-syntax -- the handler owns the window stack; its clauses are the only way to move it */
import * as Eff from "@yap/utils/effects";

/*
 * A window collects the items recorded while a scope is elaborated: a let window learns whether its
 * definition refers to itself, a Sigma window collects the metas of its `&label` references, and a
 * record field window collects the `$label` references the field makes. Windows nest with their
 * scopes, so the open windows of one scope have strictly increasing levels and an item matches at
 * most one of them. A sibling scope can reuse a level because the earlier window has closed by then.
 * An item recorded at a level with no open window is dropped, which is how a reference to a scope
 * that has already closed is ignored.
 *
 * Windows are keyed by scope as well as level because record frames live on the label stack, which
 * is numbered separately from the env: a field window and its enclosing let window can share a level.
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
