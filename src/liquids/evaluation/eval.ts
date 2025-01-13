import { match, P } from "ts-pattern";
import { Term, Neutral, App, Abs, Pi, Refined } from "../terms.js";

import * as F from "fp-ts/function";
import { isValue } from "../utils.js";
import { betaReduce } from "../typechecking/reduction.js";

export const evaluate: (t: Term) => Term = (t) =>
	match(t)
		.with({ tag: "Lit" }, F.identity)
		.with({ tag: "Var" }, F.identity)
		.with({ tag: "Ann" }, ({ term }) => evaluate(term))
		.with({ tag: "App" }, ({ func, arg }) =>
			match(evaluate(func))
				.with(
					{
						tag: "Abs",
						binder: P.when(({ tag }) => tag === "Lambda" || tag === "Pi"),
						body: P.when(isValue),
					},
					({ body }) => evaluate(betaReduce(body, arg)),
				)
				.with({ tag: "Neutral" }, ({ term: func_ }) => {
					const arg_ = match(evaluate(arg))
						.with({ tag: "Neutral" }, ({ term }) => term)
						.otherwise(F.identity);

					return Neutral(App(func_, arg_));
				})
				.otherwise((_) => {
					throw "Application of non-function";
				}),
		)
		.with({ tag: "Abs", binder: { tag: "Lambda" } }, ({ binder, body }) =>
			Abs(binder, evaluate(body)),
		)
		.with({ tag: "Abs", binder: { tag: "Pi" } }, ({ binder, body }) => {
			const t = evaluate(binder.ann);
			return Abs(Pi(binder.variable, t), evaluate(betaReduce(body, t)));
		})
		.with({ tag: "Refined" }, ({ term, ref }) => Refined(evaluate(term), ref))
		.with({ tag: "Neutral" }, F.identity)
		.otherwise((t) => {
			throw `Evaluation not yet implemented for: ${JSON.stringify(t)}`;
		});
