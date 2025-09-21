import { match, P } from "ts-pattern";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as EB from "@yap/elaboration";
import * as NF from ".";
import _ from "lodash";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import * as R from "@yap/shared/rows";
import { Option } from "fp-ts/lib/Option";
import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/NonEmptyArray";

export function evaluate(ctx: EB.Context, term: EB.Term): NF.Value {
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
			const val = ctx.ffi[variable.name];
			if (!val) {
				return NF.Constructors.Neutral(NF.Constructors.Var(variable));
			}

			if (val && val.arity === 0) {
				return val.compute();
			}

			const external = NF.Constructors.External(variable.name, val.arity, val.compute, []);
			return external;
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
					.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)))
					.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
						// Unfold the mu
						const body = apply(mu.binder, mu.closure, NF.Constructors.Neutral(mu));
						return reduce(body, nfa);
					})
					.with({ type: "Abs" }, ({ closure, binder }) => {
						return apply(binder, closure, nfa);
					})
					.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit))
					.with({ type: "Var", variable: { type: "Meta" } }, _ => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)))
					.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)))

					.with({ type: "App" }, ({ func, arg }) => {
						const nff = reduce(func, arg);
						return NF.Constructors.App(nff, nfa, icit);
					})
					.with({ type: "External" }, ({ name, args, arity, compute }) => {
						if (arity === 0) {
							return compute();
						}

						const accumulated = [...args, nfa];
						if (accumulated.length === arity) {
							return compute(...accumulated);
						}
						return NF.Constructors.External(name, arity, compute, accumulated);
					})
					.otherwise(() => {
						throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
					});

			return reduce(nff, nfa);
		})
		.with({ type: "Row" }, ({ row }) => {
			const _eval = (row: EB.Row): NF.Row =>
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

							throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val, ctx.zonker));
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

			const res = matching(ctx, scrutinee, v.alternatives);

			if (!res) {
				throw new Error("Match: No alternative matched");
			}
			return res;
		})
		.otherwise(tm => {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm, ctx.zonker));
			throw new Error("Not implemented");
		});

	//Log.logger.debug("[Result] " + NF.display(res));
	//Log.pop();

	return res;
}

export const matching = (ctx: EB.Context, tm: NF.Value, alts: EB.Alternative[]): NF.Value | undefined => {
	return match(alts)
		.with([], () => undefined)
		.with([P._, ...P.array()], ([alt, ...rest]) =>
			F.pipe(
				meet(alt.pattern, tm),
				O.map(binders => {
					const extended = binders.reduce((_ctx, { binder, q }) => EB.bind(_ctx, binder, [tm, q]), ctx);
					return evaluate(extended, alt.term);
				}),
				O.getOrElse(() => matching(ctx, tm, rest)),
			),
		)
		.exhaustive();
};

export const apply = (binder: EB.Binder, closure: NF.Closure, value: NF.Value, multiplicity: Q.Multiplicity = Q.Zero): NF.Value => {
	const { ctx, term } = closure;
	const extended = EB.extend(ctx, binder, [value, multiplicity]);

	if (closure.type === "Closure") {
		return evaluate(extended, term);
	}

	const args = extended.env.slice(0, closure.arity).map(([v]) => v);
	return closure.compute(...args);
};

export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral" }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];

const meet = (pattern: EB.Pattern, nf: NF.Value): Option<{ binder: EB.Binder; q: Q.Multiplicity }[]> => {
	return match([unwrapNeutral(nf), pattern])
		.with([P._, { type: "Wildcard" }], () => O.some([]))
		.with([P._, { type: "Binder" }], ([v, p]) => {
			const binder: EB.Binder = { type: "Lambda", variable: p.value };
			return O.some([{ binder, q: Q.Many }]);
		})
		.with(
			[{ type: "Lit" }, { type: "Lit" }],
			([v, p]) => _.isEqual(v, p),
			() => O.some([]),
		)

		.with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], ([{ arg }, p]) => meetAll(p.row, arg.row))
		.with([NF.Patterns.Row, { type: "Row" }], ([v, p]) => {
			return meetAll(p.row, v.row);
		})
		.with([NF.Patterns.Variant, { type: "Variant" }], [NF.Patterns.Struct, { type: "Variant" }], ([{ arg }, p]) => {
			return meetOne(p.row, arg.row);
		})
		.with([NF.Patterns.HashMap, { type: "List" }], ([v, p]) => {
			console.warn("List pattern matching not yet implemented");
			return O.some([]);
		})
		.with(
			[NF.Patterns.Atom, { type: "Var" }],
			([{ value: v }, { value: p }]) => v.value === p,
			() => O.some([]),
		)
		.otherwise(() => O.none);
};

const meetAll = (pats: R.Row<EB.Pattern, string>, vals: NF.Row): Option<{ binder: EB.Binder; q: Q.Multiplicity }[]> => {
	return match([pats, vals])
		.with([{ type: "empty" }, P._], () => O.some([])) // empty row matches anything
		.with([{ type: "variable" }, P._], ([r]) => {
			// bind the variable
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return O.some([{ binder, q: Q.Many }]);
		})

		.with([{ type: "extension" }, { type: "empty" }], () => O.none)
		.with([{ type: "extension" }, { type: "variable" }], () => O.none)
		.with([{ type: "extension" }, { type: "extension" }], ([r1, r2]) => {
			const rewritten = R.rewrite(r2, r1.label);
			if (E.isLeft(rewritten)) {
				return O.none;
			}

			if (rewritten.right.type !== "extension") {
				throw new Error("Rewritting a row extension should result in another row extension");
			}
			const { row } = rewritten.right;
			return F.pipe(
				O.Do,
				O.apS("current", meet(r1.value, rewritten.right.value)),
				O.apS("rest", meetAll(r1.row, row)),
				O.map(({ current, rest }) => current.concat(rest)),
			);
		})
		.exhaustive();
};

const meetOne = (pats: R.Row<EB.Pattern, string>, vals: NF.Row): Option<{ binder: EB.Binder; q: Q.Multiplicity }[]> => {
	return match([pats, vals])
		.with([{ type: "empty" }, P._], () => O.none)
		.with([{ type: "variable" }, P._], ([r]) => {
			// bind the variable
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return O.some([{ binder, q: Q.Many }]);
		})
		.with([{ type: "extension" }, { type: "empty" }], () => O.none)
		.with([{ type: "extension" }, { type: "variable" }], () => O.none)
		.with([{ type: "extension" }, { type: "extension" }], ([r1, r2]) => {
			const rewritten = R.rewrite(r2, r1.label);
			if (E.isLeft(rewritten)) {
				return meetOne(r1.row, r2);
			}

			if (rewritten.right.type !== "extension") {
				throw new Error("Rewritting a row extension should result in another row extension");
			}
			return meet(r1.value, rewritten.right.value);
		})
		.exhaustive();
};
