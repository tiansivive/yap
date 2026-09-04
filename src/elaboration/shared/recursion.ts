/* eslint-disable no-restricted-syntax -- the handler owns the window stack; its clauses are the only way to move it */
import * as Eff from "@yap/utils/effects";

/*
 * Open let-windows for recursive-definition detection.
 *
 * The freer replacement of v2's writer binder channel, scoped to its one
 * producer/consumer pair: the let boundary runs its value-check inside a
 * window (detect), and lookup flags the window whose level it resolved
 * through when the binder is Mu-tagged (muContext) — a type-level reference
 * to an in-progress let. A flag with no open window at that level is a
 * reference to an already-closed definition and is deliberately a no-op.
 *
 * Frame lifetime is the scoping: a window at level L opens under an env of
 * length L and nested windows open under deeper envs, so stacked levels
 * strictly increase and a flag matches at most one frame. Levels reused by
 * sibling scopes cannot collide because the dead window's frame is gone.
 */

type Frame = { lvl: number; recursed: boolean };

type Push = Eff.Action<"Recursion.push", number, undefined>;
type Flag = Eff.Action<"Recursion.flag", number, undefined>;
type Pop = Eff.Action<"Recursion.pop", undefined, boolean>;

/** Flags the open window at lvl, if any: a type-level reference to the let it belongs to. */
const flag = function* (lvl: number) {
	return yield* Eff.ctl.action<Flag>("Recursion.flag", lvl);
};

/** Runs program inside a window at lvl; answers with its value and whether the window was flagged. */
const detect = function* <Row extends Eff.AnyAction, A>(lvl: number, program: () => Eff.Eff<Row, A>) {
	yield* Eff.ctl.action<Push>("Recursion.push", lvl);

	const value = yield* program();

	const recursed = yield* Eff.ctl.action<Pop>("Recursion.pop", undefined);

	return [value, recursed] as const;
};

const handlers = (): Eff.Handler<Push | Flag | Pop, readonly Frame[]> => {
	/* This handler owns the stack; its clauses are the only way to move it. */
	const frames: Frame[] = [];

	return {
		clauses: {
			"Recursion.push": lvl => {
				frames.push({ lvl, recursed: false });

				return Eff.ctl.resume(undefined);
			},

			"Recursion.flag": lvl => {
				const frame = frames.find(f => f.lvl === lvl);

				if (frame) {
					frame.recursed = true;
				}

				return Eff.ctl.resume(undefined);
			},

			"Recursion.pop": () => Eff.ctl.resume(frames.pop()?.recursed ?? false),
		},

		/* Empty after a completed run; whatever was open when an abort stopped it. */
		output: () => [...frames],
	};
};

export const recursion = { flag, detect, handlers };
