/* eslint-disable no-restricted-syntax -- the handler owns the window stack; its clauses are the only way to move it */
import * as Eff from "@yap/utils/effects";

/*
 * Frame lifetime is the scoping: a window at level L opens under an env of length L and nested
 * windows open under deeper envs, so stacked levels strictly increase and a record matches at
 * most one frame. Levels reused by sibling scopes cannot collide because the dead window's
 * frame is gone. Recording against a level with no open window is deliberately a no-op — that
 * is how a reference to an already-closed scope is ignored.
 *
 * Two consumers: the let boundary, whose item is unit because only "did anything record" matters,
 * and the SigmaV2 boundary, whose item is the meta standing for a sibling's value.
 */

type Push = Eff.Action<"Recursion.push", number, undefined>;
type Record = Eff.Action<"Recursion.record", { lvl: number; item: unknown }, undefined>;
type Pop<T> = Eff.Action<"Recursion.pop", undefined, T[]>;

/** The item type is supplied first because TypeScript cannot infer `Row` and `A` once any argument is explicit. */
const within = <T>() =>
	function* <Row extends Eff.AnyAction, A>(lvl: number, program: () => Eff.Eff<Row, A>) {
		yield* Eff.ctl.action<Push>("Recursion.push", lvl);

		const value = yield* program();

		const items = yield* Eff.ctl.action<Pop<T>>("Recursion.pop", undefined);

		return [value, items] as const;
	};

const record = function* (lvl: number, item: unknown) {
	return yield* Eff.ctl.action<Record>("Recursion.record", { lvl, item });
};

type Frame = { lvl: number; items: unknown[] };

const handlers = (): Eff.Handler<Push | Record | Pop<unknown>, readonly Frame[]> => {
	const frames: Frame[] = [];

	return {
		clauses: {
			"Recursion.push": lvl => {
				frames.push({ lvl, items: [] });

				return Eff.ctl.resume(undefined);
			},

			"Recursion.record": ({ lvl, item }) => {
				frames.find(f => f.lvl === lvl)?.items.push(item);

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
		return yield* record(lvl, undefined);
	},
	detect: function* <Row extends Eff.AnyAction, A>(lvl: number, program: () => Eff.Eff<Row, A>) {
		const [value, items] = yield* within<unknown>()(lvl, program);

		return [value, items.length > 0] as const;
	},
	handlers,
};
