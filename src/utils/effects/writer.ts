/* eslint-disable no-restricted-syntax */
import { Monoid } from "fp-ts/lib/Monoid";

import { Action, AnyAction, ctl, Eff, Handler, with as scoped } from "@yap/utils/effects/freer";

/*
 * An accumulator a computation appends to, read back as the handler's output.
 *
 * A monoid combines each entry on write. A batch fold combines entries on read
 * and must give the same result when an inner listen groups several entries.
 *
 * listen and censor need a subprogram's writes on their own, which is what a
 * fresh handler over the same actions already is: Eff.with installs one for the
 * subprogram and answers with what it accumulated. The parent then tells that
 * itself, so nothing is withheld from the enclosing accumulator — and a censor
 * is the same thing with the entries changed on the way through.
 *
 * A listened program that aborts past the delimiter therefore contributes
 * nothing, while the run-level accumulator still reports what it had told. That
 * asymmetry is open, not settled: z-yap/zettels/scope-output-on-abort.md.
 */

export function writer<W>(fold: Monoid<W> | ((entries: readonly W[]) => W)) {
	type Tell = Action<"Writer.tell", W, void>;
	type Peek = Action<"Writer.peek", undefined, W>;

	const tell = function* (entry: W) {
		return yield* ctl.action<Tell>("Writer.tell", entry);
	};

	/** Everything told to the accumulator in scope. */
	const peek = function* () {
		return yield* ctl.action<Peek>("Writer.peek", undefined);
	};

	/** mtl's listen: the program's value, and what that program alone wrote. */
	const listen = function* <Row extends AnyAction, A>(program: Eff<Row, A>) {
		const [value, written] = yield* scoped([handlers()], () => program);
		yield* tell(written);

		return [value, written] as const;
	};

	/** mtl's censor: what the program wrote, transformed on its way out. */
	const censor = function* <Row extends AnyAction, A>(change: (written: W) => W, program: Eff<Row, A>) {
		const [value, written] = yield* scoped([handlers()], () => program);
		yield* tell(change(written));

		return value;
	};

	const handlers = (): Handler<Tell | Peek, W> => {
		/* This handler owns the accumulator; its clauses are the only way in. */
		const accumulator = buffer(fold);

		return {
			clauses: {
				"Writer.tell": entry => {
					accumulator.append(entry);

					return ctl.resume(undefined);
				},

				"Writer.peek": () => ctl.resume(accumulator.read()),
			},

			/* Read after the scope ends, so an abort still reports what had been told. */
			output: accumulator.read,
		};
	};

	return { tell, peek, listen, censor, handlers };
}

/* A batch fold lets an array writer flatten once on read. Monoid writers support constant-time reads. */
const buffer = <W>(fold: Monoid<W> | ((entries: readonly W[]) => W)) => {
	if (typeof fold === "function") {
		const entries: W[] = [];
		return { append: (entry: W) => entries.push(entry), read: () => fold(entries) };
	}
	let value = fold.empty;
	return {
		append: (entry: W) => {
			value = fold.concat(value, entry);
		},
		read: () => value,
	};
};
