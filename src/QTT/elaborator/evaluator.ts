import { match } from "ts-pattern";
import * as NF from "./normalized";
import * as El from "./syntax";

import Shared, { Multiplicity } from "../shared";

import * as Con from "./constructors";

export function evaluate(env: NF.Env, term: El.Term): NF.Value {
	return match(term)
		.with({ type: "Lit" }, ({ value }): NF.Value => Con.Type.Lit(value))
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) =>
			Con.Type.Neutral(variable),
		)
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
				const annotation = evaluate(env, binding.annotation);
				const ma = NF.infer(env, annotation);
				return Con.Type.Pi(
					binding.variable,
					binding.icit,
					ma,
					NF.Closure(env, body),
				);
			},
		)
		.otherwise(() => {
			throw new Error("Not implemented");
		});
}

export const apply = (
	closure: NF.Closure,
	value: NF.Value,
	multiplicity: Multiplicity = Shared.Zero,
): NF.Value => {
	const { env, term } = closure;
	return evaluate([[value, multiplicity], ...env], term);
};
