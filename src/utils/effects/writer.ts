/* eslint-disable no-restricted-syntax */
import { Monoid } from "fp-ts/lib/Monoid";

import { Action, AnyAction, ctl, Eff, Handler } from "@yap/utils/effects/freer";

/*
 * An accumulator a computation appends to, read back as the handler's output.
 *
 * The actions fix what an entry is; the handler picks how entries combine, so
 * one set of actions admits as many handlers as there are Monoids over W.
 *
 * listen and censor open a nested accumulator and close it again, which is why
 * they answer with what a subprogram alone wrote rather than everything so far.
 */

export function writer<W>(monoid: Monoid<W>) {
	type Tell = Action<"Writer.tell", W, void>;
	type Peek = Action<"Writer.peek", undefined, W>;
	type Open = Action<"Writer.open", undefined, undefined>;
	type Close = Action<"Writer.close", (written: W) => W, W>;

	const tell = function* (entry: W) {
		return yield* ctl.action<Tell>("Writer.tell", entry);
	};

	/** Everything written so far in the innermost scope. */
	const peek = function* () {
		return yield* ctl.action<Peek>("Writer.peek", undefined);
	};

	/** mtl's listen: the program's value, and what that program alone wrote. */
	const listen = function* <Row extends AnyAction, A>(program: Eff<Row, A>) {
		yield* ctl.action<Open>("Writer.open", undefined);
		const value = yield* program;
		const written = yield* ctl.action<Close>("Writer.close", entries => entries);

		return [value, written] as const;
	};

	/** mtl's censor: what the program wrote, transformed on its way out. */
	const censor = function* <Row extends AnyAction, A>(change: (written: W) => W, program: Eff<Row, A>) {
		yield* ctl.action<Open>("Writer.open", undefined);
		const value = yield* program;
		yield* ctl.action<Close>("Writer.close", change);

		return value;
	};

	const handlers = (): Handler<Tell | Peek | Open | Close, W> => {
		/* This handler owns the scopes; its clauses are the only way in. */
		const scopes: W[] = [monoid.empty];
		const innermost = () => scopes.length - 1;

		return {
			clauses: {
				"Writer.tell": entry => {
					scopes[innermost()] = monoid.concat(scopes[innermost()], entry);

					return ctl.resume(undefined);
				},

				"Writer.peek": () => ctl.resume(scopes[innermost()]),

				"Writer.open": () => {
					scopes.push(monoid.empty);

					return ctl.resume(undefined);
				},

				"Writer.close": change => {
					const written = change(scopes.length > 1 ? (scopes.pop() ?? monoid.empty) : monoid.empty);
					scopes[innermost()] = monoid.concat(scopes[innermost()], written);

					return ctl.resume(written);
				},
			},

			/* Folded, so an abort inside a listen still yields what it had written. */
			output: () => scopes.reduce((left, right) => monoid.concat(left, right), monoid.empty),
		};
	};

	return { tell, peek, listen, censor, handlers };
}
