/* eslint-disable no-restricted-syntax */
import { Monoid } from "fp-ts/lib/Monoid";

import { Action, AnyAction, ctl, Eff, Handler, with as scoped } from "@yap/utils/effects/freer";

/*
 * An accumulator a computation appends to, read back as the handler's output.
 *
 * The actions fix what an entry is; the handler picks how entries combine, so
 * one set of actions admits as many handlers as there are Monoids over W.
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

export function writer<W>(monoid: Monoid<W>) {
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
		let accumulated: W = monoid.empty;

		return {
			clauses: {
				"Writer.tell": entry => {
					accumulated = monoid.concat(accumulated, entry);

					return ctl.resume(undefined);
				},

				"Writer.peek": () => ctl.resume(accumulated),
			},

			/* Read after the scope ends, so an abort still reports what had been told. */
			output: () => accumulated,
		};
	};

	return { tell, peek, listen, censor, handlers };
}
