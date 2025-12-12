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

/**
 * Stack-based evaluation to prevent stack overflow on deeply recursive Yap programs.
 *
 * Uses two GLOBAL stacks shared across all evaluation calls:
 * - workStack: frames to process (either evaluate a term or apply a continuation)
 * - resultStack: completed values waiting to be consumed by continuations
 *
 * Each call to evaluate() only processes work items it added (tracks initial stack size).
 * This allows helpers to recursively call evaluate() without allocating new stacks.
 * The stacks grow on the heap, not the JS call stack.
 */

type StackFrame = { type: "Eval"; ctx: EB.Context; term: EB.Term } | { type: "Cont"; arity: number; handler: (results: NF.Value[]) => void };

// GLOBAL stacks - reused across all evaluate calls
const globalWorkStack: StackFrame[] = [];
const globalResultStack: NF.Value[] = [];

export function evaluate(ctx: EB.Context, term: EB.Term, maxSteps = 10000000): NF.Value {
	// Track where this call's work starts in the global stack
	const initialWorkSize = globalWorkStack.length;
	const initialResultSize = globalResultStack.length;

	// Add our work
	globalWorkStack.push({ type: "Eval", ctx, term });

	let steps = 0;

	// Only process work items we added (everything beyond initialWorkSize)
	while (globalWorkStack.length > initialWorkSize) {
		steps++;
		if (steps > maxSteps) {
			throw new Error(`Evaluation exceeded maximum steps (${maxSteps}). Possible infinite loop in: ${EB.Display.Term(term, ctx)}`);
		}

		const frame = globalWorkStack.pop()!;

		if (frame.type === "Cont") {
			// Pop required results and apply continuation
			const args = globalResultStack.splice(-frame.arity, frame.arity);
			if (args.length !== frame.arity) {
				throw new Error(`Continuation expected ${frame.arity} results but got ${args.length}`);
			}
			frame.handler(args);
		} else {
			// Evaluate term
			evaluateTerm(frame.ctx, frame.term);
		}
	}

	// We should have exactly one result from our work
	const resultCount = globalResultStack.length - initialResultSize;
	if (resultCount !== 1) {
		throw new Error(`Expected exactly 1 result, got ${resultCount}`);
	}

	return globalResultStack.pop()!;
}

function evaluateTerm(ctx: EB.Context, term: EB.Term): void {
	match(term)
		.with({ type: "Lit" }, ({ value }) => {
			globalResultStack.push(NF.Constructors.Lit(value));
		})
		.with({ type: "Var", variable: { type: "Label" } }, ({ variable }) => {
			const sig = ctx.sigma[variable.name];
			if (!sig) {
				throw new Error("Unbound label: " + variable.name);
			}

			if (sig.nf) {
				globalResultStack.push(sig.nf);
				return;
			}
			if (!sig.term) {
				throw new Error("Label has no term or normal form: " + variable.name);
			}

			// Need to evaluate the label's term
			globalWorkStack.push({ type: "Eval", ctx, term: sig.term });
		})
		.with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
			const val = ctx.imports[variable.name];

			if (!val) {
				throw new Error("Unbound free variable: " + variable.name);
			}

			// For recursive functions, we need to tie the knot
			const binder: EB.Binder = { type: "Let", variable: variable.name };
			const lvl = ctx.env.length;

			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl }),
				type: [binder, "source", val[1]],
				name: binder,
			};

			const xtended = { ...ctx, env: [entry, ...ctx.env] };

			// Push continuation to tie the knot
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([result]) => {
					entry.nf = result;
					globalResultStack.push(result);
				},
			});

			// Evaluate in extended context
			globalWorkStack.push({ type: "Eval", ctx: xtended, term: val[0] });
		})
		.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
			if (!ctx.zonker[variable.val]) {
				const v = NF.Constructors.Var(variable);
				globalResultStack.push(NF.Constructors.Neutral(v));
				return;
			}

			// Force re-evaluation of zonker value
			const quoted = NF.quote(ctx, ctx.env.length, ctx.zonker[variable.val]);
			globalWorkStack.push({ type: "Eval", ctx, term: quoted });
		})
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			const entry = ctx.env[variable.index];
			if (entry.type[0].type === "Mu") {
				globalResultStack.push(NF.Constructors.Neutral(entry.nf));
			} else {
				globalResultStack.push(entry.nf);
			}
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
			const val = ctx.ffi[variable.name];
			if (!val) {
				globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.Var(variable)));
				return;
			}

			if (val && val.arity === 0) {
				globalResultStack.push(val.compute());
				return;
			}

			const external = NF.Constructors.External(variable.name, val.arity, val.compute, []);
			globalResultStack.push(external);
		})
		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => {
			// Evaluate annotation, then construct Lambda
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([ann]) => {
					globalResultStack.push(NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: binding.annotation });
		})
		.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => {
			// Evaluate annotation, then construct Pi
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([ann]) => {
					globalResultStack.push(NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body)));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: binding.annotation });
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

			// Setup sigma context with neutral label vars
			const sigma = Object.entries(bindings).reduce<EB.Context["sigma"]>((sig, b) => {
				const [label, term] = b;
				if (sig[label]) {
					return sig;
				}
				const v = NF.Constructors.Var({ type: "Label", name: label });
				return { ...sig, [label]: { nf: NF.Constructors.Neutral(v) } as EB.Sigma };
			}, ctx.sigma);

			const xtended = { ...ctx, sigma };

			// Evaluate row then construct Sigma
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([ann]) => {
					globalResultStack.push(NF.Constructors.Sigma(binding.variable, ann, NF.Constructors.Closure(ctx, body)));
				},
			});

			// Evaluate the row
			evalRowPush(xtended, binding.annotation.row);
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, mu => {
			// Evaluate annotation, then construct Mu
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([ann]) => {
					globalResultStack.push(NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body)));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: mu.binding.annotation });
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			// Evaluate func and arg, then reduce using stack-based reduce
			globalWorkStack.push({
				type: "Cont",
				arity: 2,
				handler: ([funcVal, argVal]) => {
					reduceAndPushStack(funcVal, argVal, icit);
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: arg });
			globalWorkStack.push({ type: "Eval", ctx, term: func });
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

			// Evaluate row and wrap in Row constructor
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([rowVal]) => {
					globalResultStack.push(rowVal); // Already a Row value
				},
			});

			evalRowPush(xtended, row);
		})
		.with({ type: "Match" }, v => {
			// Evaluate scrutinee, then match
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([scrutinee]) => {
					const isStuck = (val: NF.Value) =>
						match(val)
							.with({ type: "Neutral" }, neutral =>
								match(neutral.value)
									.with(NF.Patterns.Struct, NF.Patterns.Schema, NF.Patterns.Variant, NF.Patterns.Array, () => false)
									.otherwise(() => true),
							)
							.otherwise(() => false);

					if (isStuck(scrutinee)) {
						globalResultStack.push(NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee));
						return;
					}

					matchingAndPushStack(ctx, scrutinee, v.alternatives);
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: v.scrutinee });
		})
		.with({ type: "Proj" }, ({ term, label }) => {
			// Evaluate base, then project
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([base]) => {
					globalResultStack.push(projectValue(base, label, ctx, term));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term });
		})
		.with({ type: "Inj" }, ({ term, label, value: valueTerm }) => {
			// Evaluate base and value, then inject
			globalWorkStack.push({
				type: "Cont",
				arity: 2,
				handler: ([base, injected]) => {
					globalResultStack.push(injectValue(base, label, injected, valueTerm, ctx));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: valueTerm });
			globalWorkStack.push({ type: "Eval", ctx, term });
		})
		.with({ type: "Modal" }, ({ term, modalities }) => {
			// Evaluate term and liquid, then wrap in Modal
			globalWorkStack.push({
				type: "Cont",
				arity: 2,
				handler: ([nf, liquid]) => {
					const result = match(nf)
						.with(NF.Patterns.Modal, ({ modalities: innerModalities, value }) => {
							const combined = Modal.combine(innerModalities, { quantity: modalities.quantity, liquid }, ctx);
							return NF.Constructors.Modal(value, combined);
						})
						.otherwise(v => NF.Constructors.Modal(v, { quantity: modalities.quantity, liquid }));
					globalResultStack.push(result);
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: modalities.liquid });
			globalWorkStack.push({ type: "Eval", ctx, term });
		})
		.with({ type: "Block" }, ({ statements, return: ret }) => {
			// Process statements to extend context, then evaluate return
			processStatementsAndPush(statements, ctx, ret);
		})
		.with({ type: "Reset" }, ({ body }) => {
			// Evaluate the reset body
			// For now, just evaluate the body directly
			// TODO: Mark this as a reset delimiter for shift to capture
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([result]) => {
					// Wrap result in Reset value for now
					globalResultStack.push(NF.Constructors.Reset(result));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: body });
		})
		.with({ type: "Shift" }, ({ arg }) => {
			// Evaluate the shift argument
			// For now, just evaluate the argument
			// TODO: Capture the continuation up to the enclosing reset
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([argVal]) => {
					// Wrap argument in Shift value for now
					globalResultStack.push(NF.Constructors.Shift(argVal));
				},
			});
			globalWorkStack.push({ type: "Eval", ctx, term: arg });
		})
		.otherwise(tm => {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm, ctx));
			throw new Error("Not implemented");
		});
}

/**
 * Process block statements, evaluating let bindings and extending context.
 * Pushes work onto global stack instead of recursing.
 */
function processStatementsAndPush(stmts: EB.Statement[], ctx: EB.Context, returnTerm: EB.Term): void {
	if (stmts.length === 0) {
		// No more statements, evaluate the return term
		globalWorkStack.push({ type: "Eval", ctx, term: returnTerm });
		return;
	}

	const [current, ...rest] = stmts;

	match(current)
		.with({ type: "Let" }, ({ variable, annotation, value }) => {
			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length }),
				type: [{ type: "Let", variable }, "source", annotation],
				name: { type: "Let", variable },
			};
			const extended = { ...ctx, env: [entry, ...ctx.env] };

			// Push continuation to process remaining statements after this value is evaluated
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([val]) => {
					entry.nf = val;
					processStatementsAndPush(rest, extended, returnTerm);
				},
			});

			// Evaluate the value
			globalWorkStack.push({ type: "Eval", ctx: extended, term: value });
		})
		.with({ type: "Expression" }, ({ value }) => {
			// Push continuation to discard result and continue
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([_val]) => {
					processStatementsAndPush(rest, ctx, returnTerm);
				},
			});

			// Evaluate the expression
			globalWorkStack.push({ type: "Eval", ctx, term: value });
		})
		.with({ type: "Using" }, ({ value, annotation }) => {
			const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([value, annotation]));
			processStatementsAndPush(rest, updated, returnTerm);
		})
		.exhaustive();
}

/**
 * Push work to evaluate a row onto the global stack.
 * Rows are evaluated recursively from right to left, building up the result.
 */
function evalRowPush(ctx: EB.Context, row: EB.Row): void {
	match(row)
		.with({ type: "empty" }, r => {
			globalWorkStack.push({
				type: "Cont",
				arity: 0,
				handler: _args => {
					globalResultStack.push(NF.Constructors.Row(r));
				},
			});
		})
		.with({ type: "extension" }, ({ label, value: term, row: restRow }) => {
			// Evaluate value and rest, then construct extension
			globalWorkStack.push({
				type: "Cont",
				arity: 2,
				handler: ([value, rest]) => {
					// rest should be a Row value
					if (rest.type !== "Row") {
						throw new Error("Expected Row value in row evaluation");
					}
					globalResultStack.push(NF.Constructors.Row(NF.Constructors.Extension(label, value, rest.row)));
				},
			});

			// Push rest row evaluation
			evalRowPush(ctx, restRow);

			// Push value evaluation (will complete first due to stack order)
			globalWorkStack.push({ type: "Eval", ctx, term });
		})
		.with({ type: "variable" }, r => {
			if (r.variable.type === "Meta") {
				const zonked = ctx.zonker[r.variable.val];
				if (!zonked) {
					const v = r.variable;
					globalWorkStack.push({
						type: "Cont",
						arity: 0,
						handler: _args => {
							globalResultStack.push(NF.Constructors.Row({ type: "variable", variable: v }));
						},
					});
					return;
				}

				// Handle zonked meta
				if (zonked.type === "Row") {
					globalWorkStack.push({
						type: "Cont",
						arity: 0,
						handler: _args => {
							globalResultStack.push(zonked);
						},
					});
					return;
				}

				if (zonked.type === "Var") {
					globalWorkStack.push({
						type: "Cont",
						arity: 0,
						handler: _args => {
							globalResultStack.push(NF.Constructors.Row({ type: "variable", variable: zonked.variable }));
						},
					});
					return;
				}

				throw new Error("Zonked meta in row position is not a row or variable: " + NF.display(zonked, ctx));
			}

			if (r.variable.type === "Bound") {
				const { nf } = ctx.env[r.variable.index];
				const val = unwrapNeutral(nf);

				if (val.type === "Row") {
					globalWorkStack.push({
						type: "Cont",
						arity: 0,
						handler: _args => {
							globalResultStack.push(val);
						},
					});
					return;
				}

				if (val.type === "Var") {
					globalWorkStack.push({
						type: "Cont",
						arity: 0,
						handler: _args => {
							globalResultStack.push(NF.Constructors.Row({ type: "variable", variable: val.variable }));
						},
					});
					return;
				}

				throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val, ctx));
			}

			throw new Error(`Eval Row Variable: Not implemented yet: ${JSON.stringify(r)}`);
		})
		.otherwise(() => {
			throw new Error("Not implemented");
		});
}

/**
 * Project a label from a value.
 * Extracted from the original Proj case for use in continuation handler.
 */
function projectValue(base: NF.Value, label: string, ctx: EB.Context, originalTerm: EB.Term): NF.Value {
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
	const lambda = NF.Constructors.Lambda(binder, "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
	const app = NF.Constructors.App(lambda, base, "Explicit");
	return NF.Constructors.Neutral(app);
}

/**
 * Inject a value into a row at the given label.
 * Extracted from the original Inj case for use in continuation handler.
 */
function injectValue(base: NF.Value, label: string, injected: NF.Value, valueTerm: EB.Term, ctx: EB.Context): NF.Value {
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
}

/**
 * Reduce function application and push result to global result stack.
 */
/**
 * Stack-based reduce: apply function to argument without calling evaluate.
 * Inlines apply semantics for Abs case.
 */
function reduceAndPushStack(nff: NF.Value, nfa: NF.Value, icit: Implicitness): void {
	match(nff)
		.with({ type: "Neutral" }, ({ value }) => {
			globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)));
		})
		.with({ type: "Modal" }, ({ modalities, value }) => {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			// Recursively reduce the inner value
			reduceAndPushStack(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, () => {
			// Do not unfold mu during normalization - defer to unification
			globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Abs" }, ({ closure, binder }) => {
			// Inline apply semantics: extend context and evaluate body
			const extended = (() => {
				if (binder.type !== "Sigma") {
					return EB.extend(closure.ctx, binder, nfa);
				}
				assert(nfa.type === "Row", "Sigma binder should be applied to a Row");
				return EB.extendSigmaEnv(closure.ctx, nfa.row);
			})();

			if (closure.type === "Closure") {
				// Push evaluation of the body
				globalWorkStack.push({ type: "Eval", ctx: extended, term: closure.term });
			} else {
				// ForeignClosure: compute with environment arguments
				const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
				globalResultStack.push(closure.compute(...args));
			}
		})
		.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => {
			globalResultStack.push(NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit));
		})
		.with({ type: "Var", variable: { type: "Meta" } }, () => {
			globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, () => {
			globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "App" }, ({ func, arg, icit: argIcit }) => {
			// Reduce func to arg first, then apply result to nfa
			// This is a recursive reduction, not evaluation
			const intermediate = reduce(func, arg, argIcit);
			reduceAndPushStack(intermediate, nfa, icit);
		})
		.with({ type: "External" }, ({ name, args, arity, compute }) => {
			if (arity === 0) {
				globalResultStack.push(compute());
				return;
			}

			const accumulated = [...args, nfa];

			if (accumulated.length < arity) {
				globalResultStack.push(NF.Constructors.External(name, arity, compute, accumulated));
				return;
			}

			if (accumulated.some(a => a.type === "Neutral")) {
				globalResultStack.push(NF.Constructors.Neutral(NF.Constructors.External(name, arity, compute, accumulated)));
				return;
			}

			globalResultStack.push(compute(...accumulated.map(ignoraModal)));
		})
		.otherwise(() => {
			throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
		});
}

/**
 * Stack-based matching: push alternatives as work items instead of recursively calling evaluate.
 */
function matchingAndPushStack(ctx: EB.Context, nf: NF.Value, alts: EB.Alternative[]): void {
	if (alts.length === 0) {
		throw new Error("Match: No alternative matched");
	}

	const [alt, ...rest] = alts;
	const meetResult = meet(ctx, alt.pattern, nf);

	if (O.isSome(meetResult)) {
		// Pattern matched: extend context and evaluate body
		const binders = meetResult.value;
		const extendedCtx = binders.reduce((_ctx, { binder, nf }) => EB.extend(_ctx, binder, nf), ctx);
		globalWorkStack.push({ type: "Eval", ctx: extendedCtx, term: alt.term });
	} else {
		// Pattern didn't match: try next alternative
		matchingAndPushStack(ctx, nf, rest);
	}
}

// Re-export helper functions that are still used
export const reduce = (nff: NF.Value, nfa: NF.Value, icit: Implicitness): NF.Value =>
	match(nff)
		.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit)))
		.with({ type: "Modal" }, ({ modalities, value }) => {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			return reduce(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
			// Do not unfold mu during normalization - defer to unification
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
		.with([{ type: "empty" }, P._], () => O.some([]))
		.with([{ type: "variable" }, P._], ([r, tail]) => {
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
