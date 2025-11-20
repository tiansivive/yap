import * as NF from "@yap/elaboration/normalization";

import * as O from "fp-ts/lib/Option";
import * as F from "fp-ts/lib/function";

import { match } from "ts-pattern";

export const unfoldMu = (app: Extract<NF.Value, { type: "App" }>): O.Option<NF.Value> => {
	const { func, arg, icit } = app;
	return match(func)
		.with({ type: "App" }, fn =>
			F.pipe(
				unfoldMu(fn),
				O.map(f => NF.reduce(f, arg, icit)),
			),
		)
		.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
			const body = NF.apply(mu.binder, mu.closure, mu);
			const unfolded = NF.reduce(body, arg, icit);
			return O.some(unfolded);
		})
		.otherwise(() => O.none);
};
