import { match } from "ts-pattern";
import * as NF from "./normalized";
import * as El from "./syntax";

import Shared, { Multiplicity } from "../shared";

import * as Con from "./constructors";
import * as Elab from "./elaborate";

export function evaluate(
	env: NF.Env,
	imports: Elab.Context["imports"],
	term: El.Term,
): NF.Value {
	return match(term)
		.with({ type: "Lit" }, ({ value }): NF.Value => Con.Type.Lit(value))
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
			const val = imports[variable.name];

			if (!val) {
				throw new Error("Unbound free variable: " + variable.name);
			}
			return evaluate(env, imports, val[0]);
		})
		.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) =>
			Con.Type.Neutral(variable),
		)
		.with(
			{ type: "Var", variable: { type: "Bound" } },
			({ variable }) => env[variable.index][0],
		)

		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) =>
			Con.Type.Lambda(binding.variable, binding.icit, NF.Closure(env, body)),
		)
		.with(
			{ type: "Abs", binding: { type: "Pi" } },
			({ body, binding }): NF.Value => {
				const annotation = evaluate(env, imports, binding.annotation);
				const ma = NF.infer(env, annotation);
				return Con.Type.Pi(
					binding.variable,
					binding.icit,
					ma,
					NF.Closure(env, body),
				);
			},
		)
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const nff = evaluate(env, imports, func);
			const nfa = evaluate(env, imports, arg);

			return match(nff)
				.with({ type: "Abs", binder: { type: "Lambda" } }, ({ closure }) =>
					apply(imports, closure, nfa),
				)
				.with({ type: "Neutral" }, () => Con.Type.App(nff, nfa, icit))
				.otherwise(() => {
					throw new Error(
						"Impossible: Tried to apply a non-function while evaluating: " +
							JSON.stringify(nff),
					);
				});
		})
		.otherwise(() => {
			throw new Error("Not implemented");
		});
}

export const apply = (
	imports: Elab.Context["imports"],
	closure: NF.Closure,
	value: NF.Value,
	multiplicity: Multiplicity = Shared.Zero,
): NF.Value => {
	const { env, term } = closure;
	return evaluate([[value, multiplicity], ...env], imports, term);
};
