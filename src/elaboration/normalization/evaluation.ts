import { match, P } from "ts-pattern";

import * as El from "../index";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as EB from "@yap/elaboration";
import * as NF from ".";
import _ from "lodash";

export function evaluate(ctx: EB.Context, term: El.Term): NF.Value {
	//Log.push("eval");
	//Log.logger.debug(EB.Display.Term(term), { ctx.env,  term: EB.Display.Term(term) });
	const res = match(term)
		.with({ type: "Lit" }, ({ value }): NF.Value => NF.Constructors.Lit(value))
		.with({ type: "Var", variable: { type: "Label" } }, ({ variable }): NF.Value => {
			const sig = ctx.sigma[variable.name];

			if (!sig) {
				throw new Error("Unbound label: " + variable.name);
			}

			return sig.nf;
		})
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
			const val = ctx.imports[variable.name];

			if (!val) {
				throw new Error("Unbound free variable: " + variable.name);
			}

			return evaluate(ctx, val[0]);
		})
		.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => NF.Constructors.Neutral<NF.Value>({ type: "Var", variable }))
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			return ctx.env[variable.index][0];
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
			return NF.Constructors.Neutral(NF.Constructors.Var(variable));
		})

		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) =>
			NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body)),
		)
		.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }): NF.Value => {
			const annotation = evaluate(ctx, binding.annotation);
			return NF.Constructors.Pi(binding.variable, binding.icit, [annotation, binding.multiplicity], NF.Constructors.Closure(ctx, body));
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, (mu): NF.Value => {
			const annotation = evaluate(ctx, mu.binding.annotation);

			const val = NF.Constructors.Mu(mu.binding.variable, mu.binding.source, [annotation, Q.Many], NF.Constructors.Closure(ctx, mu.body));
			const extended = EB.unfoldMu(ctx, { type: "Mu", variable: mu.binding.variable }, [val, Q.Many]);
			return evaluate(extended, mu.body);
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const nff = evaluate(ctx, func);
			const nfa = evaluate(ctx, arg);

			const reduce = (nff: NF.Value, nfa: NF.Value): NF.Value =>
				match(nff)
					.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
						// Unfold the mu
						const body = apply(mu.binder, mu.closure, NF.Constructors.Neutral(mu));
						return reduce(body, nfa);
					})
					.with({ type: "Abs" }, ({ closure, binder }) => {
						return apply(binder, closure, nfa);
					})
					.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit))
					.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)))
					.with({ type: "Var", variable: { type: "Meta" } }, _ => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)))
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
						const value = evaluate(ctx, term);
						const rest = _eval(row);
						return NF.Constructors.Extension(label, value, rest);
					})
					.with({ type: "variable" }, (r): NF.Row => {
						if (r.variable.type === "Meta") {
							return { type: "variable", variable: r.variable };
						}

						if (r.variable.type === "Bound") {
							const [_val] = ctx.env[r.variable.index];
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
		.with({ type: "Match" }, v => {
			// console.warn("Evaluating match terms not yet implemented. Returning scrutinee as Normal Form for the time being");
			const scrutinee = evaluate(ctx, v.scrutinee);
			if (scrutinee.type === "Neutral" || (scrutinee.type === "Var" && scrutinee.variable.type === "Meta")) {
				const lambda = NF.Constructors.Lambda("_scrutinee", "Explicit", NF.Constructors.Closure(ctx, v));
				const app = NF.Constructors.App(lambda, scrutinee, "Explicit");
				return NF.Constructors.Neutral(app);
			}

			const res = meet(ctx, scrutinee, v.alternatives);

			if (!res) {
				throw new Error("Match: No alternative matched");
			}
			return res;
		})
		.otherwise(tm => {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm));
			throw new Error("Not implemented");
		});

	//Log.logger.debug("[Result] " + NF.display(res));
	//Log.pop();

	return res;
}

export const meet = (ctx: EB.Context, tm: NF.Value, alts: EB.Alternative[]): NF.Value | undefined => {
	return match(alts)
		.with([], () => undefined)
		.with([P._, ...P.array()], ([alt, ...rest]) => {
			return match([unwrapNeutral(tm), alt.pattern])
				.with([P._, { type: "Wildcard" }], () => evaluate(ctx, alt.term))
				.with([P._, { type: "Binder" }], ([v, p]) => {
					const extended = EB.bind(ctx, { type: "Lambda", variable: p.value }, [v, Q.Many]);
					return evaluate(extended, alt.term);
				})
				.with(
					[{ type: "Lit" }, { type: "Lit" }],
					([v, p]) => _.isEqual(v, p),
					() => evaluate(ctx, alt.term),
				)

				.with([NF.Patterns.Schema, { type: "Struct" }], ([{ arg }, p]) => {
					console.warn("Struct pattern matching not yet implemented");
					return evaluate(ctx, alt.term);
				})
				.with([NF.Patterns.Row, { type: "Row" }], ([v, p]) => {
					console.warn("Row pattern matching not yet implemented");
					return evaluate(ctx, alt.term);
				})
				.with([NF.Patterns.Variant, { type: "Variant" }], ([v, p]) => {
					console.warn("Variant pattern matching not yet implemented");
					return evaluate(ctx, alt.term);
				})
				.with([NF.Patterns.HashMap, { type: "List" }], ([v, p]) => {
					console.warn("List pattern matching not yet implemented");
					return evaluate(ctx, alt.term);
				})
				.with(
					[NF.Patterns.Atom, { type: "Var" }],
					([{ value: v }, { value: p }]) => v.value === p,
					() => evaluate(ctx, alt.term),
				)
				.otherwise(() => meet(ctx, tm, rest));
		})
		.exhaustive();
};

export const apply = (binder: EB.Binder, closure: NF.Closure, value: NF.Value, multiplicity: Q.Multiplicity = Q.Zero): NF.Value => {
	const { ctx, term } = closure;

	const extended = EB.extend(ctx, binder, [value, multiplicity]);
	return evaluate(extended, term);
};

export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral" }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];
