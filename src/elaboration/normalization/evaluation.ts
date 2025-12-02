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
import * as A from "fp-ts/lib/Array";
import { Liquid } from "@yap/verification/modalities";
import * as Modal from "@yap/verification/modalities/shared";
import { Implicitness } from "@yap/shared/implicitness";
import { update } from "@yap/utils";
import assert from "assert";

export function evaluate(ctx: EB.Context, term: EB.Term, bindings: { [key: string]: EB.Term } = {}, fuel = 0): NF.Value {
	//Log.push("eval");
	//Log.logger.debug(EB.Display.Term(term), { ctx.env,  term: EB.Display.Term(term) });
	fuel++;
	if (fuel > 1000) {
		throw new Error("Evaluation ran out of fuel. Possible infinite loop in term evaluation: " + EB.Display.Term(term, ctx));
	}
	const res = match(term)
		.with({ type: "Lit" }, ({ value }): NF.Value => NF.Constructors.Lit(value))
		.with({ type: "Var", variable: { type: "Label" } }, ({ variable }): NF.Value => {
			const sig = ctx.sigma[variable.name];
			if (!sig) {
				throw new Error("Unbound label: " + variable.name);
			}

			if (sig.nf) {
				return sig.nf;
			}
			if (!sig.term) {
				throw new Error("Label has no term or normal form: " + variable.name);
			}

			return evaluate(ctx, sig.term, bindings, fuel);
		})
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
			const val = ctx.imports[variable.name];

			if (!val) {
				throw new Error("Unbound free variable: " + variable.name);
			}

			// For recursive functions, we need to tie the knot: evaluate the term
			// in a context where it can refer to itself. We do this by:
			// 1. Creating a bound variable as a placeholder
			// 2. Extending the context with this placeholder
			// 3. Evaluating the term in the extended context
			// 4. Mutating the env entry to point to the actual result
			// This works because the context is captured in the closure, so mutating this reference will update the closure context as well
			// Subsequent evaluation of the closure body will then see the correct, updated value
			// TODO: This is a bit hacky, but it works for now. We might want to revisit this later for a cleaner solution and avoid mutation
			const binder: EB.Binder = { type: "Let", variable: variable.name };
			const lvl = ctx.env.length;

			// Create env entry with placeholder - this will be mutated after evaluation
			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl }), // placeholder
				type: [binder, "source", val[1]], // use the type from imports
				name: binder,
			};

			// Extend context with the entry
			const xtended = { ...ctx, env: [entry, ...ctx.env] };

			// Evaluate in extended context - recursive calls will find the Bound var
			const result = evaluate(xtended, val[0], bindings, fuel);

			// "Tie the knot" - update placeholder to actual result
			// This makes recursive references work correctly
			entry.nf = result;

			return result;
		})
		.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
			if (!ctx.zonker[variable.val]) {
				const v = NF.Constructors.Var(variable);
				return NF.Constructors.Neutral(v);
			}

			// NOTE: little trick to force re-evaluation of the zonker value in case it is a rigid
			const quoted = NF.quote(ctx, ctx.env.length, ctx.zonker[variable.val]);
			return evaluate(ctx, quoted, bindings, fuel);
			// return ctx.zonker[variable.val];
		})
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			const entry = ctx.env[variable.index];
			if (entry.type[0].type === "Mu") {
				return NF.Constructors.Neutral(entry.nf);
			}
			return entry.nf;
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

		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => {
			const ann = evaluate(ctx, binding.annotation, bindings, fuel);
			return NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann);
		})
		.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }): NF.Value => {
			const ann = evaluate(ctx, binding.annotation, bindings, fuel);
			return NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body));
		})
		.with({ type: "Abs", binding: { type: "Sigma" } }, ({ body, binding }) => {
			assert(binding.annotation.type === "Row", "Sigma binder annotation must be a Row");
			const extract = (r: EB.Row): { [key: string]: EB.Term } => {
				if (r.type === "empty" || r.type === "variable") {
					return {};
				}

				const { label, value, row } = r;
				return { [label]: value, ...extract(row) };
			};
			const bindings = extract(binding.annotation.row);

			// Block labels from fully reducing by wrapping them as neutral label vars.
			// Sigma types encode the types of the fields which is different from value-level rows.
			// For the latter, we can eagerly follow the dependencies to fully evaluate the row structure.
			// Eg: Struct [x: 1, y: :x + 1] can be fully evaluated to Struct [x: 1, y: 2].
			// However, for Sigma types, a label reference means "use the value of that field, which we have typed as X", not its evaluated result.
			// This is what allows types to depend on values!
			// Eg: ∑sig:[x: Int, y: fn :x]. Schema [x: Int, y: fn :x] means applying the value of field x when constructing the type of field y.
			// This means that when evaluating (normalizing!) a Sigma, we have to preserve the label references as-is, because we do not have the actual values at this point.
			// Using neutral vars for labels achieves this.
			// Later on, checking a value against a Sigma type will actually perform the necessary reductions using the real values.
			const sigma = Object.entries(bindings).reduce<EB.Context["sigma"]>((sig, b) => {
				const [label, term] = b;

				if (sig[label]) {
					return sig;
				}
				const v = NF.Constructors.Var({ type: "Label", name: label });
				return { ...sig, [label]: { nf: NF.Constructors.Neutral(v) } as EB.Sigma };
			}, ctx.sigma);
			const xtended = { ...ctx, sigma };
			const ann = evalRow(xtended, binding.annotation.row, bindings);
			return NF.Constructors.Sigma(binding.variable, NF.Constructors.Row(ann), NF.Constructors.Closure(ctx, body));
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, (mu): NF.Value => {
			const ann = evaluate(ctx, mu.binding.annotation, bindings, fuel);
			const val = NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body));
			return val;
			// NOTE: This is commented out because we want to defer unfolding of mu types to unification. This has the benefit of displaying the recursive type more closely to the source
			// const extended = EB.unfoldMu(ctx, { type: "Mu", variable: mu.binding.variable }, val);
			// return evaluate(extended, mu.body);
		})

		.with({ type: "App" }, ({ func, arg, icit }) => {
			const nff = evaluate(ctx, func, bindings, fuel);
			const nfa = evaluate(ctx, arg, bindings, fuel);
			return reduce(nff, nfa, icit);
		})
		.with({ type: "Row" }, ({ row }) => {
			const extract = (r: EB.Row): { [key: string]: EB.Term } => {
				if (r.type === "empty" || r.type === "variable") {
					return {};
				}

				const { label, value, row } = r;
				return { [label]: value, ...extract(row) };
			};
			const bindings = extract(row);

			const sigma = Object.entries(bindings).reduce<EB.Context["sigma"]>((sig, b) => {
				const [label, term] = b;

				if (sig[label]) {
					return sig;
				}

				return { ...sig, [label]: { term, multiplicity: Q.Many } as EB.Sigma };
			}, ctx.sigma);
			const xtended = { ...ctx, sigma };
			return NF.Constructors.Row(evalRow(xtended, row, {}));
			//return NF.Constructors.Row(evalRow(ctx, row, bindings));
		})
		.with({ type: "Match" }, v => {
			const scrutinee = evaluate(ctx, v.scrutinee, bindings, fuel);
			if (scrutinee.type === "Neutral" || (scrutinee.type === "Var" && scrutinee.variable.type === "Meta")) {
				return NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee);
			}

			const res = matching(ctx, scrutinee, v.alternatives);

			if (!res) {
				throw new Error("Match: No alternative matched");
			}
			return res;
		})
		.with({ type: "Proj" }, ({ term, label }) => {
			const base = evaluate(ctx, term, bindings, fuel);

			type ProjectAttempt = { tag: "found"; value: NF.Value } | { tag: "blocked" } | { tag: "missing" } | { tag: "not-applicable" };

			const lookupRow = (row: NF.Row): ProjectAttempt => {
				switch (row.type) {
					case "empty":
						return { tag: "missing" };
					case "variable":
						return { tag: "blocked" };
					case "extension":
						if (row.label === label) {
							return { tag: "found", value: row.value };
						}
						return lookupRow(row.row);
				}
			};

			const attemptProject = (value: NF.Value): ProjectAttempt => {
				const target = unwrapNeutral(value);

				return match(target)
					.with({ type: "Neutral" }, (): ProjectAttempt => ({ tag: "blocked" }))
					.with(NF.Patterns.Row, ({ row }) => lookupRow(row))
					.with(NF.Patterns.Struct, NF.Patterns.Schema, NF.Patterns.Variant, ({ arg }) => lookupRow(arg.row))
					.otherwise((): ProjectAttempt => ({ tag: "not-applicable" }));
			};

			const attempt = attemptProject(base);

			if (attempt.tag === "found") {
				return attempt.value;
			}

			if (attempt.tag === "missing") {
				throw new Error(`Projection: label ${label} not found`);
			}

			const binder = `$proj_${label}`;
			const body = EB.Constructors.Proj(label, EB.Constructors.Var({ type: "Bound", index: 0 }));
			const lambda = NF.Constructors.Lambda(binder, "Explicit", NF.Constructors.Closure(ctx, body), NF.Any); //QUESTION: Is the Any here ok? This is a dummy type anyways...
			const app = NF.Constructors.App(lambda, base, "Explicit");
			return NF.Constructors.Neutral(app);
		})
		.with({ type: "Inj" }, ({ term, label, value: valueTerm }) => {
			const base = evaluate(ctx, term, bindings, fuel);
			const injected = evaluate(ctx, valueTerm, bindings, fuel);

			type InjectAttempt = { tag: "updated"; value: NF.Value } | { tag: "blocked" } | { tag: "not-applicable" };

			const setRowValue = (row: NF.Row): NF.Row => {
				switch (row.type) {
					case "empty":
						return NF.Constructors.Extension(label, injected, row);
					case "variable":
						return NF.Constructors.Extension(label, injected, row);
					case "extension": {
						if (row.label === label) {
							return NF.Constructors.Extension(label, injected, row.row);
						}
						const rest = setRowValue(row.row);
						return NF.Constructors.Extension(row.label, row.value, rest);
					}
				}
			};

			const attemptInject = (value: NF.Value): InjectAttempt => {
				const target = unwrapNeutral(value);

				return match(target)
					.with({ type: "Neutral" }, (): InjectAttempt => ({ tag: "blocked" }))
					.with(NF.Patterns.Row, ({ row }): InjectAttempt => {
						const updated = setRowValue(row);
						return { tag: "updated", value: NF.Constructors.Row(updated) };
					})
					.with(NF.Patterns.Struct, NF.Patterns.Schema, NF.Patterns.Variant, matched => {
						const updated = setRowValue(matched.arg.row);

						const updatedRow = NF.Constructors.Row(updated);
						return { tag: "updated", value: NF.Constructors.App(matched.func, updatedRow, matched.icit) } satisfies InjectAttempt;
					})
					.otherwise((): InjectAttempt => ({ tag: "not-applicable" }));
			};

			const attempt = attemptInject(base);

			if (attempt.tag === "updated") {
				return attempt.value;
			}

			const binder = `$inj_${label}`;
			const body = EB.Constructors.Inj(label, valueTerm, EB.Constructors.Var({ type: "Bound", index: 0 }));
			const lambda = NF.Constructors.Lambda(binder, "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
			const app = NF.Constructors.App(lambda, base, "Explicit");
			return NF.Constructors.Neutral(app);
		})
		.with({ type: "Modal" }, ({ term, modalities }) => {
			const nf = evaluate(ctx, term, bindings, fuel);

			return NF.Constructors.Modal(nf, {
				quantity: modalities.quantity,
				liquid: NF.evaluate(ctx, modalities.liquid, bindings, fuel),
			});
		})
		.with({ type: "Block" }, ({ statements, return: ret }) => {
			const process = (stmts: EB.Statement[], ctx: EB.Context): EB.Context => {
				if (stmts.length === 0) {
					return ctx;
				}
				const [current, ...rest] = stmts;

				return match(current)
					.with({ type: "Let" }, ({ variable, annotation, value }) => {
						const entry: EB.Context["env"][number] = {
							nf: NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length }),
							type: [{ type: "Let", variable }, "source", annotation],
							name: { type: "Let", variable },
						};
						const extended = { ...ctx, env: [entry, ...ctx.env] };
						entry.nf = evaluate(extended, value, bindings, fuel);
						return process(rest, extended);
					})
					.with({ type: "Expression" }, ({ value }) => {
						evaluate(ctx, value, bindings, fuel);
						return process(rest, ctx);
					})
					.with({ type: "Using" }, ({ value, annotation }) => {
						// const nf = evaluate(ctx, value, bindings, fuel);
						const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([value, annotation]));
						return process(rest, updated);
					})
					.exhaustive();
			};

			return evaluate(process(statements, ctx), ret, bindings, fuel);
		})
		.otherwise(tm => {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm, ctx));
			throw new Error("Not implemented");
		});

	return res;
}

export const reduce = (nff: NF.Value, nfa: NF.Value, icit: Implicitness): NF.Value =>
	match(nff)
		.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)))
		.with({ type: "Modal" }, ({ modalities, value }) => {
			// QUESTION: Perhaps we preserve the modalities on the result of the application?
			// Is this related to the concept of "measures" in Liquid Haskell
			// If we have a fn `f: (Int -> Int){ x | <refinement on an arrow type? }
			// What could we refine f itself to be?
			// And if we apply f to an argument, what could we refine the result to be?
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			return reduce(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
			// Unfold the mu
			// const body = apply(mu.binder, mu.closure, mu);
			// return reduce(body, nfa, icit);

			// NOTE: Do not unfold the mu during normalization/evaluation. Defer that to unification as that's where we actually need to see the structure inside recursive types
			return NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit));
		})
		.with({ type: "Abs" }, ({ closure, binder }) => {
			return apply(binder, closure, nfa);
		})
		.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit))
		.with({ type: "Var", variable: { type: "Meta" } }, _ => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)))
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)))

		.with({ type: "App" }, ({ func, arg, icit }) => {
			const nff = reduce(func, arg, icit);
			return NF.Constructors.App(nff, nfa, icit);
		})
		.with({ type: "External" }, ({ name, args, arity, compute }) => {
			if (arity === 0) {
				return compute();
			}

			const accumulated = [...args, nfa];

			if (accumulated.length < arity) {
				return NF.Constructors.External(name, arity, compute, accumulated);
			}

			if (accumulated.some(a => a.type === "Neutral")) {
				const external = NF.Constructors.External(name, arity, compute, accumulated);
				return NF.Constructors.Neutral(external);
			}

			return compute(...accumulated.map(ignoraModal));
		})
		.otherwise(() => {
			throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
		});

export const matching = (ctx: EB.Context, nf: NF.Value, alts: EB.Alternative[]): NF.Value | undefined => {
	return match(alts)
		.with([], () => undefined)
		.with([P._, ...P.array()], ([alt, ...rest]) =>
			F.pipe(
				meet(ctx, alt.pattern, nf),
				O.map(binders => {
					const extended = binders.reduce((_ctx, { binder, nf }) => EB.extend(_ctx, binder, nf), ctx);
					return evaluate(extended, alt.term);
				}),
				O.getOrElse(() => matching(ctx, nf, rest)),
			),
		)
		.exhaustive();
};

export function apply(binder: EB.Binder, closure: NF.Closure, value: NF.Value): NF.Value {
	let { ctx, term } = closure;

	const extended = (() => {
		if (binder.type !== "Sigma") {
			return EB.extend(ctx, binder, value);
		}
		assert(value.type === "Row", "Sigma binder should be applied to a Row");
		return EB.extendSigmaEnv(ctx, value.row);
	})();

	if (closure.type === "Closure") {
		return evaluate(extended, term);
	}

	const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
	return closure.compute(...args);
}

export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral" }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

export const force = (ctx: EB.Context, value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral" }, ({ value }) => force(ctx, value))
		.with(NF.Patterns.Flex, ({ variable }) => {
			if (ctx.zonker[variable.val]) {
				return force(ctx, ctx.zonker[variable.val]);
			}
			return NF.Constructors.Neutral(value);
		})
		.otherwise(() => value);
};

export const ignoraModal = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Modal" }, ({ value }) => ignoraModal(value))
		.otherwise(() => value);
};

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];

export type MeetResult = { binder: EB.Binder; nf: NF.Value };
export const meet = (ctx: EB.Context, pattern: EB.Pattern, nf: NF.Value): Option<MeetResult[]> => {
	return match([unwrapNeutral(nf), pattern])
		.with([P._, { type: "Wildcard" }], () => O.some([]))
		.with([P._, { type: "Binder" }], ([v, p]) => {
			const binder: EB.Binder = { type: "Lambda", variable: p.value };
			return O.some<MeetResult[]>([{ binder, nf }]);
		})
		.with(
			[{ type: "Lit" }, { type: "Lit" }],
			([v, p]) => _.isEqual(v.value, p.value),
			() => O.some([]),
		)
		.with(
			[NF.Patterns.Array, { type: "List" }],
			([v, p]) => v.arg.row.type === "empty" && p.patterns.length === 0 && !p.rest,
			() => O.some([]),
		)
		.with(
			[NF.Patterns.Array, { type: "List" }],
			([v, p]) => p.patterns.length === 0 && !p.rest,
			() => O.none,
		)
		.with([NF.Patterns.Array, { type: "List" }], ([v, p]) => {
			const zip = (patterns: EB.Pattern[], row: NF.Row): O.Option<MeetResult[]> => {
				if (patterns.length === 0) {
					if (!p.rest) {
						return O.some([]);
					}

					const tail = NF.Constructors.Array(row);
					const binder: EB.Binder = { type: "Lambda", variable: p.rest };
					return O.some([{ binder, nf: tail }]);
				}

				if (row.type !== "extension") {
					return O.none;
				}

				const [head, ...tail] = patterns;
				return F.pipe(
					O.Do,
					O.apS("head", meet(ctx, head, row.value)),
					O.apS("tail", zip(tail, row.row)),
					O.map(({ head, tail }) => [...head, ...tail]),
				);
			};

			return zip(p.patterns, v.arg.row);
		})

		.with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], ([{ arg }, p]) => meetAll(ctx, p.row, arg.row))
		.with([NF.Patterns.Row, { type: "Row" }], ([v, p]) => {
			return meetAll(ctx, p.row, v.row);
		})
		.with([NF.Patterns.Variant, { type: "Variant" }], [NF.Patterns.Struct, { type: "Variant" }], ([{ arg }, p]) => {
			return meetAll(ctx, p.row, arg.row);
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

const meetAll = (ctx: EB.Context, pats: R.Row<EB.Pattern, string>, vals: NF.Row): Option<MeetResult[]> => {
	return match([pats, vals])
		.with([{ type: "empty" }, P._], () => O.some([])) // empty row matches anything
		.with([{ type: "variable" }, P._], ([r, tail]) => {
			// bind the variable
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return O.some([{ binder, nf: NF.Constructors.Row(tail) }]);
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
				O.apS("current", meet(ctx, r1.value, rewritten.right.value)),
				O.apS("rest", meetAll(ctx, r1.row, row)),
				O.map(({ current, rest }) => current.concat(rest)),
			);
		})
		.exhaustive();
};

const evalRow = (ctx: EB.Context, row: EB.Row, bindings: { [key: string]: EB.Term }): NF.Row =>
	match(row)
		.with({ type: "empty" }, r => r)
		.with({ type: "extension" }, ({ label, value: term, row }) => {
			const value = evaluate(ctx, term, bindings);
			const rest = evalRow(ctx, row, bindings);
			return NF.Constructors.Extension(label, value, rest);
		})
		.with({ type: "variable" }, (r): NF.Row => {
			if (r.variable.type === "Meta") {
				// Check if the meta is solved in the zonker
				const zonked = ctx.zonker[r.variable.val];
				if (!zonked) {
					return { type: "variable", variable: r.variable };
				}

				// Force the zonked value - it might be a Bound variable or another row
				// If it's a row, return it directly
				if (zonked.type === "Row") {
					return zonked.row;
				}

				// If it's a variable (Bound, Meta, etc.), return it as the row variable
				if (zonked.type === "Var") {
					return { type: "variable", variable: zonked.variable };
				}

				throw new Error("Zonked meta in row position is not a row or variable: " + NF.display(zonked, ctx));
			}

			if (r.variable.type === "Bound") {
				const { nf } = ctx.env[r.variable.index];
				const val = unwrapNeutral(nf);

				if (val.type === "Row") {
					return val.row;
				}

				if (val.type === "Var") {
					return { type: "variable", variable: val.variable };
				}

				throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val, ctx));
			}

			throw new Error(`Eval Row Variable: Not implemented yet: ${JSON.stringify(r)}`);
		})
		.otherwise(() => {
			throw new Error("Not implemented");
		});
