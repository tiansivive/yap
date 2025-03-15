import { match } from "ts-pattern";

import * as El from "../index";

import * as Q from "@qtt/shared/modalities/multiplicity";

import * as EB from "@qtt/elaboration";
import * as NF from ".";

import * as Log from "@qtt/shared/logging";
import * as Sub from "@qtt/elaboration/substitution";

export function evaluate(env: NF.Env, imports: EB.Context["imports"], term: El.Term): NF.Value {
	//Log.push("eval");
	//Log.logger.debug(EB.Display.Term(term), { env, imports, term: EB.Display.Term(term) });
	const res = match(term)
		.with({ type: "Lit" }, ({ value }): NF.Value => NF.Constructors.Lit(value))
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
			const val = imports[variable.name];

			if (!val) {
				throw new Error("Unbound free variable: " + variable.name);
			}

			return evaluate(env, imports, val[0]);
		})
		.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => NF.Constructors.Neutral<NF.Value>({ type: "Var", variable }))
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			return env[variable.index][0];
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
			throw new Error("Tried to evaluate foreign variable: " + variable.name);
		})

		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) =>
			NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(env, body)),
		)
		.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }): NF.Value => {
			const annotation = evaluate(env, imports, binding.annotation);
			return NF.Constructors.Pi(binding.variable, binding.icit, [annotation, binding.multiplicity], NF.Constructors.Closure(env, body));
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, (mu): NF.Value => {
			const annotation = evaluate(env, imports, mu.binding.annotation);

			const val = NF.Constructors.Mu(mu.binding.variable, mu.binding.source, [annotation, Q.Many], NF.Constructors.Closure(env, mu.body));
			return evaluate([[val, Q.Many], ...env], imports, mu.body);
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const nff = evaluate(env, imports, func);
			const nfa = evaluate(env, imports, arg);

			const reduce = (nff: NF.Value, nfa: NF.Value): NF.Value =>
				match(nff)
					.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
						// Unfold the mu
						const body = apply(imports, mu.closure, NF.Constructors.Neutral(mu));
						return reduce(body, nfa);
					})
					.with({ type: "Abs" }, ({ closure }) => {
						return apply(imports, closure, nfa);
					})
					.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit))
					.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)))
					.with({ type: "App" }, ({ func, arg }) => {
						const nff = reduce(func, arg);
						return NF.Constructors.App(nff, nfa, icit);
					})
					.otherwise(() => {
						throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
					});

			return reduce(nff, nfa);
		})
		.with({ type: "Row" }, ({ row }) => {
			const _eval = (row: El.Row): NF.Row =>
				match(row)
					.with({ type: "empty" }, r => r)
					.with({ type: "extension" }, ({ label, value: term, row }) => {
						const value = evaluate(env, imports, term);
						const rest = _eval(row);
						return NF.Constructors.Extension(label, value, rest);
					})
					.with({ type: "variable" }, (r): NF.Row => {
						if (r.variable.type === "Meta") {
							return { type: "variable", variable: r.variable };
						}

						if (r.variable.type === "Bound") {
							const [_val] = env[r.variable.index];
							const val = unwrapNeutral(_val);

							if (val.type === "Row") {
								return val.row;
							}

							if (val.type === "Var") {
								return { type: "variable", variable: val.variable };
							}

							throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val));
						}

						throw new Error(`Eval Row Variable: Not implemented yet: ${JSON.stringify(r)}`);
					})
					.otherwise(() => {
						throw new Error("Not implemented");
					});

			return NF.Constructors.Row(_eval(row));
		})
		.otherwise(tm => {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm));
			throw new Error("Not implemented");
		});

	//Log.logger.debug("[Result] " + NF.display(res));
	//Log.pop();

	return res;
}

export const apply = (imports: EB.Context["imports"], closure: NF.Closure, value: NF.Value, multiplicity: Q.Multiplicity = Q.Zero): NF.Value => {
	const { env, term } = closure;
	return evaluate([[value, multiplicity], ...env], imports, term);
};

export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral" }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];
