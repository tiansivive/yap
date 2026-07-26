/* eslint-disable no-restricted-syntax, no-restricted-properties, prefer-const, @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion, @typescript-eslint/consistent-type-assertions --
 * Deliberately imperative: NbE evaluation runs an explicit work-stack machine, and shift/reset
 * capture slices the live stack for continuations. The file is tech debt scheduled for a rewrite
 * into a generator-based Evaluation monad that owns the stack as state (mirroring the lowering
 * monad), so its lint debt is intentionally not paid down — see z-yap [[evaluation-monad-rework]].
 * This directive is self-retiring: reportUnusedDisableDirectives flags it once the rework lands.
 */
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from ".";

import _ from "lodash";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import * as R from "@yap/shared/rows";
import { Option } from "fp-ts/lib/Option";
import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/Array";
import * as Modal from "@yap/verification/modalities/shared";
import { Implicitness } from "@yap/shared/implicitness";
import { update } from "@yap/utils";
import assert from "assert";

import * as Lit from "@yap/shared/literals";

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

export type StackFrame =
	| { type: "Eval"; ctx: EB.Context; term: EB.Term; noInlineBindings?: boolean }
	| { type: "Cont"; arity: number; handler: (results: NF.Value[]) => void }
	| { type: "Delimiter"; ctx: EB.Context; resultSize: number };

export type EvalOptions = {
	/** no δ-reduction: prevents inlining of definitions. Default is `false`. */
	noInlineBindings?: boolean;
	/** fuel cap: maximum number of evaluation steps before throwing an error. Default is `10,000,000`. */
	maxSteps?: number;
};

// GLOBAL stacks - reused across all evaluate calls
const globalWorkStack: StackFrame[] = [];
const globalResultStack: NF.Value[] = [];

export function evaluate(ctx: EB.Context, term: EB.Term, opts: EvalOptions = {}): NF.Value {
	const { noInlineBindings = false, maxSteps = 10000000 } = opts;
	// Track where this call's work starts in the global stack
	const initialWorkSize = globalWorkStack.length;
	const initialResultSize = globalResultStack.length;

	// Add our work
	globalWorkStack.push({ type: "Eval", ctx, term, noInlineBindings });

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
		} else if (frame.type === "Delimiter") {
			// Reset delimiter reached - the result is already on the stack from the enclosed term
			// Just pass through - the delimiter stays processed
			continue;
		} else {
			// Evaluate term
			evaluateTerm(frame.ctx, frame.term, frame.noInlineBindings ?? false);
		}
	}

	// We should have exactly one result from our work
	const resultCount = globalResultStack.length - initialResultSize;
	if (resultCount !== 1) {
		throw new Error(`Expected exactly 1 result, got ${resultCount}`);
	}

	return globalResultStack.pop()!;
}

function evaluateTerm(ctx: EB.Context, term: EB.Term, noInlineBindings: boolean): void {
	match(term)
		.with({ type: "Lit" }, ({ value }) => {
			globalResultStack.push(NF.Constructors.Lit(value));
		})
		.with({ type: "Var", variable: { type: "Label" } }, ({ variable }) => {
			const sig = ctx.sigma[variable.name];
			if (sig) {
				globalResultStack.push(sig.value);
				return;
			}
			const rec = ctx.record[variable.name];
			if (rec) {
				if (rec.value) {
					globalResultStack.push(rec.value);
					return;
				}
				if (rec.term) {
					globalWorkStack.push({ type: "Eval", ctx, term: rec.term });
					return;
				}
			}
			throw new Error("Unbound label: " + variable.name);
		})
		.with(
			{ type: "Var", variable: { type: "Free" } },
			_ => noInlineBindings,
			({ variable }) => {
				globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
			},
		)
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
				globalResultStack.push(NF.Constructors.Neutral("Symbolic", v));
				return;
			}

			// Force re-evaluation of zonker value
			const quoted = NF.quote(ctx, ctx.env.length, ctx.zonker[variable.val]);
			globalWorkStack.push({ type: "Eval", ctx, term: quoted });
		})
		.with(
			{ type: "Var", variable: { type: "Bound" } },
			_ => noInlineBindings,
			({ variable }) => {
				const lvl = ctx.env.length - 1 - variable.index;
				globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.Var({ type: "Bound", lvl })));
			},
		)
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			const entry = ctx.env[variable.index];
			match(entry.type[0])
				.with({ type: "Mu" }, () => globalResultStack.push(NF.Constructors.Neutral("Sealed", entry.nf)))
				.otherwise(() => globalResultStack.push(entry.nf));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
			const val = ctx.ffi[variable.name];
			if (!val) {
				globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
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

			const extractLabels = (r: EB.Row): { [key: string]: EB.Term } => {
				if (r.type === "empty" || r.type === "variable") {
					return {};
				}
				const { label, value, row } = r;
				return { [label]: value, ...extractLabels(row) };
			};
			const bindings = extractLabels(binding.annotation.row);

			const sigma = Object.entries(bindings).reduce<EB.Context["sigma"]>((sig, [label]) => {
				if (sig[label]) {
					return sig;
				}
				const v = NF.Constructors.Var({ type: "Label", name: label });
				return { ...sig, [label]: { value: NF.Constructors.Neutral("Symbolic", v) } };
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
			const extractLabels = (r: EB.Row): { [key: string]: EB.Term } => {
				if (r.type === "empty" || r.type === "variable") {
					return {};
				}
				const { label, value, row } = r;
				return { [label]: value, ...extractLabels(row) };
			};
			const bindings = extractLabels(row);

			const record = Object.entries(bindings).reduce<EB.Context["record"]>((rec, [label, term]) => {
				if (rec[label]) {
					return rec;
				}
				return { ...rec, [label]: { term } };
			}, ctx.record);

			const xtended = { ...ctx, record };

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
					const known = view(ctx, scrutinee);
					if (known.kind !== "Sealed") {
						globalResultStack.push(NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee));
						return;
					}

					matchingAndPushStack(ctx, known.value, v.alternatives);
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
					globalResultStack.push(projectValue(base, label, ctx));
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
					globalResultStack.push(injectValue(base, label, injected, ctx));
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
		.with({ type: "Reset" }, ({ term }) => {
			// Reset establishes a delimiter for continuation capture.
			// We annotate the delimiter with the current result stack size so that
			// shift can restore it when capturing.
			globalWorkStack.push({ type: "Delimiter", ctx, resultSize: globalResultStack.length });
			globalWorkStack.push({ type: "Eval", ctx, term });
		})
		.with({ type: "Shift" }, ({ body }) => {
			// At this point the typing phase has already desugared
			//   shift e
			// into
			//   shift (\k -> e[k])
			// where each `resume v` in `e` became `k v`.
			//
			// Here we implement the dynamic semantics: capture the continuation
			// up to the nearest Reset-delimiter, package it as a function value,
			// and apply the body-lambda to that continuation.
			globalWorkStack.push({
				type: "Cont",
				arity: 1,
				handler: ([h]) => {
					// Find the nearest reset delimiter.
					const delimiterIndex = globalWorkStack.findLastIndex(frame => frame.type === "Delimiter");
					if (delimiterIndex < 0) {
						throw new Error("Shift without enclosing reset");
					}

					// Extract delimiter, captured frames, and the result suffix produced
					// inside this reset up to the shift point.
					const delimiter = globalWorkStack[delimiterIndex] as Extract<StackFrame, { type: "Delimiter" }>;
					const capturedFrames: StackFrame[] = globalWorkStack.slice(delimiterIndex + 1);
					const capturedResults = globalResultStack.slice(delimiter.resultSize);

					// Restore work/result stacks to the state at reset, so the current
					// evaluation no longer sees the aborted inner continuation.
					globalWorkStack.splice(delimiterIndex); // drop delimiter + frames
					globalResultStack.splice(delimiter.resultSize);

					// Build a continuation closure that, when applied to a value v,
					// will replay the captured continuation as if it had been
					// resumed at the shift point.
					const continuation: NF.Closure = {
						type: "Continuation",
						frames: capturedFrames,
						results: capturedResults,
						ctx: delimiter.ctx,
						term: EB.Constructors.Lit(Lit.unit()), // dummy term
					};

					const kVal = NF.Constructors.Lambda("kArg", "Explicit", continuation, NF.Any);

					// Now apply the desugared handler `h : (A -> R) -> R` to the
					// continuation value `kVal`.
					reduceAndPushStack(h, kVal, "Explicit");
				},
			});
			// Evaluate the body-lambda; the above continuation receives it.
			globalWorkStack.push({ type: "Eval", ctx, term: body });
		})
		.with({ type: "Bubble" }, ({ meta, shift }) => {
			const delimiterIndex = globalWorkStack.findLastIndex(frame => frame.type === "Delimiter");
			if (delimiterIndex >= 0) {
				globalWorkStack.push({ type: "Eval", ctx, term: shift });
			} else {
				const v = NF.Constructors.Var({ type: "Meta", val: meta, lvl: 0 });
				globalResultStack.push(NF.Constructors.Neutral("Symbolic", v));
			}
		})
		.with({ type: "Ann" }, ({ term }) => {
			globalWorkStack.push({ type: "Eval", ctx, term });
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
			// no delta-reduction: we don't want to inline the value, just evaluate it and add it to implicits
			const nfValue = evaluate(ctx, value, { noInlineBindings: true });
			const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([nfValue, annotation]));
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

type Project = { tag: "found"; value: NF.Value } | { tag: "blocked" } | { tag: "missing" } | { tag: "not-applicable" };

const project = (ctx: EB.Context, base: NF.Value, label: string): Project => {
	const current = match(base)
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, ({ value }) => ctx.sigma[value.variable.name]?.value ?? base)
		.otherwise(() => base);

	const lookup = (row: NF.Row): Project =>
		match(row)
			.with({ type: "empty" }, (): Project => ({ tag: "missing" }))
			.with({ type: "variable" }, (): Project => ({ tag: "blocked" }))
			.with({ type: "extension" }, ({ label: current, value, row }) => (current === label ? ({ tag: "found", value } satisfies Project) : lookup(row)))
			.exhaustive();

	return match(view(ctx, current))
		.with({ kind: "Symbolic" }, (): Project => ({ tag: "blocked" }))
		.with({ kind: "Blocked" }, (): Project => ({ tag: "blocked" }))
		.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => lookup(value.row))
		.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) => lookup(value.arg.row))
		.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) => lookup(value.arg.row))
		.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) => lookup(value.arg.row))
		.otherwise((): Project => ({ tag: "not-applicable" }));
};

function projectValue(base: NF.Value, label: string, ctx: EB.Context): NF.Value {
	return match(project(ctx, base, label))
		.with({ tag: "found" }, ({ value }) => value)
		.with({ tag: "missing" }, () => {
			throw new Error(`Projection: label ${label} not found`);
		})
		.otherwise(() => NF.Constructors.StuckProj(base, label));
}

const inject = (ctx: EB.Context, base: NF.Value, label: string, injected: NF.Value): NF.Value | undefined => {
	const set = (row: NF.Row): NF.Row =>
		match(row)
			.with({ type: "empty" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "variable" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "extension" }, ({ label: current, value, row }) =>
				current === label ? NF.Constructors.Extension(label, injected, row) : NF.Constructors.Extension(current, value, set(row)),
			)
			.exhaustive();

	return match(view(ctx, base))
		.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => NF.Constructors.Row(set(value.row)))
		.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.otherwise(() => undefined);
};

function injectValue(base: NF.Value, label: string, injected: NF.Value, ctx: EB.Context): NF.Value {
	return inject(ctx, base, label, injected) ?? NF.Constructors.StuckInj(base, label, injected);
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
		.with({ type: "Neutral" }, ({ kind, value }) => {
			globalResultStack.push(NF.Constructors.Neutral(kind, NF.Constructors.App(value, nfa, icit)));
		})
		.with({ type: "Modal" }, ({ modalities, value }) => {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			// Recursively reduce the inner value
			reduceAndPushStack(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, () => {
			// Do not unfold mu during normalization - defer to unification
			globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Abs" }, ({ closure, binder }) => {
			// Inline apply semantics: extend context and evaluate body
			const extended = (cls: Exclude<NF.Closure, { type: "Continuation" }>) => {
				if (binder.type !== "Sigma") {
					return EB.extend(cls.ctx, binder, nfa);
				}
				assert(nfa.type === "Row", "Sigma binder should be applied to a Row");
				return EB.extendSigma(cls.ctx, nfa.row);
			};
			match(closure)
				.with({ type: "Closure" }, cls => globalWorkStack.push({ type: "Eval", ctx: extended(cls), term: cls.term }))
				.with({ type: "PrimOp" }, primop => {
					const args = extended(primop)
						.env.slice(0, primop.arity)
						.map(({ nf }) => nf);
					globalResultStack.push(primop.compute(...args));
				})
				.with({ type: "Continuation" }, cont => {
					// Restore the captured result suffix and then push the new argument.
					globalResultStack.push(...cont.results);
					globalResultStack.push(nfa);
					// Replay captured frames as the rest of the delimited continuation.
					globalWorkStack.push(...cont.frames);
					return;
				})
				.exhaustive();
		})
		.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => {
			globalResultStack.push(NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit));
		})
		.with({ type: "Var", variable: { type: "Meta" } }, () => {
			globalResultStack.push(NF.Constructors.Neutral("Symbolic", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, () => {
			globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
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
				globalResultStack.push(NF.Constructors.Neutral("Sealed", NF.Constructors.External(name, arity, compute, accumulated)));
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
		.with({ type: "Neutral" }, ({ kind, value }) => NF.Constructors.Neutral(kind, NF.Constructors.App(value, nfa, icit)))
		.with({ type: "Modal" }, ({ modalities, value }) => {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			return reduce(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
			// Do not unfold mu during normalization - defer to unification
			return NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit));
		})
		.with({ type: "Abs" }, ({ closure, binder }) => {
			return apply(binder, closure, nfa);
		})
		.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit))
		.with({ type: "Var", variable: { type: "Meta" } }, _ => NF.Constructors.Neutral("Symbolic", NF.Constructors.App(nff, nfa, icit)))
		.with({ type: "Var", variable: { type: "Foreign" } }, () => NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)))
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
				return NF.Constructors.Neutral("Sealed", external);
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
	// Check if this is a captured continuation being applied
	if (closure.type === "Continuation") {
		// This is a continuation - replay the captured frames in a local loop.
		// Restore captured result suffix and then push the new argument.
		const initialWorkSize = globalWorkStack.length;
		const initialResultSize = globalResultStack.length;
		globalResultStack.push(...closure.results);
		globalResultStack.push(value);

		// Replay all captured frames
		for (const frame of closure.frames) {
			globalWorkStack.push(frame);
		}

		let steps = 0;
		const maxSteps = 10000000;

		while (globalWorkStack.length > initialWorkSize) {
			steps++;
			if (steps > maxSteps) {
				throw new Error(`Continuation replay exceeded maximum steps`);
			}

			const frame = globalWorkStack.pop()!;

			if (frame.type === "Cont") {
				const args = globalResultStack.splice(-frame.arity, frame.arity);
				if (args.length !== frame.arity) {
					throw new Error(`Continuation expected ${frame.arity} results but got ${args.length}`);
				}
				frame.handler(args);
			} else if (frame.type === "Delimiter") {
				continue;
			} else {
				evaluateTerm(frame.ctx, frame.term, frame.noInlineBindings ?? false);
			}
		}

		// Return the result from the replayed computation
		const resultCount = globalResultStack.length - initialResultSize;
		if (resultCount !== 1) {
			throw new Error(`Continuation replay expected 1 result, got ${resultCount}`);
		}

		return globalResultStack.pop()!;
	}

	let { ctx, term } = closure;

	const extended = (() => {
		if (binder.type !== "Sigma") {
			return EB.extend(ctx, binder, value);
		}
		assert(value.type === "Row", "Sigma binder should be applied to a Row");
		return EB.extendSigma(ctx, value.row);
	})();

	if (closure.type === "Closure") {
		return evaluate(extended, term);
	}

	const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
	return closure.compute(...args);
}

export type View = { kind: NF.Neutral; value: NF.Value };

export const resume = (ctx: EB.Context, value: NF.Value): Option<NF.Value> =>
	match(value)
		.with(NF.Patterns.Proj, ({ base, label }) =>
			match(project(ctx, base, label))
				.with({ tag: "found" }, ({ value }) => O.some(value))
				.with({ tag: "missing" }, () => {
					throw new Error(`Projection: label ${label} not found`);
				})
				.otherwise(() => O.none),
		)
		.with(NF.Patterns.Match, ({ closure, scrutinee }) => {
			const known = view(ctx, scrutinee);
			if (known.kind !== "Sealed") {
				return O.none;
			}
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");
			const result = matching(closure.ctx, known.value, closure.term.alternatives);
			if (!result) {
				throw new Error("Match: No alternative matched");
			}
			return O.some(result);
		})
		.with(NF.Patterns.Inj, ({ base, label, injected }) => O.fromNullable(inject(ctx, base, label, injected)))
		.otherwise(() => O.none);

export function force(ctx: EB.Context, value: NF.Value): NF.Value {
	return match(value)
		.with({ type: "Neutral", kind: "Sealed" }, () => value)
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, ({ value: label }) => {
			return match(ctx.sigma[label.variable.name])
				.with({ value: { type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label } }, ({ value: placeholder }) =>
					placeholder.value.variable.name === label.variable.name ? value : force(ctx, placeholder),
				)
				.with({ value: P.select() }, resolved => force(ctx, resolved))
				.otherwise(() => value);
		})
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Flex }, ({ value: flex }) => {
			const solution = ctx.zonker[flex.variable.val];
			return solution ? force(ctx, solution) : value;
		})
		.with({ type: "Neutral", kind: "Symbolic" }, () => value)
		.with({ type: "Neutral", kind: "Blocked" }, ({ value: blocked }) =>
			F.pipe(
				resume(ctx, blocked),
				O.match(
					() => value,
					next => force(ctx, next),
				),
			),
		)
		.with(NF.Patterns.Flex, ({ variable }) => {
			const solution = ctx.zonker[variable.val];
			return solution ? force(ctx, solution) : value;
		})
		.otherwise(() => value);
}

export function view(ctx: EB.Context, value: NF.Value): View {
	const forced = force(ctx, value);
	return match(forced)
		.with({ type: "Neutral" }, ({ kind, value }) => ({ kind, value }))
		.otherwise(value => ({ kind: "Sealed", value }));
}

export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral", kind: P.union("Symbolic", "Sealed") }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

export const ignoraModal = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Modal" }, ({ value }) => ignoraModal(value))
		.otherwise(() => value);
};

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];

export type MeetResult = { binder: EB.Binder; nf: NF.Value };

const ExtensionRow = O.fromPredicate((row: R.Row<EB.Pattern, string>): row is R.Extension<EB.Pattern, string> => row.type === "extension");

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
		.with([NF.Patterns.Tagged, { type: "Variant", row: { type: "extension" } }], ([{ arg }, p]) => {
			const value = NF.TaggedValue.extract(arg.row);
			if (!value) {
				return O.none;
			}

			return F.pipe(
				R.rewrite(p.row, value.label),
				E.fold(
					() => O.none,
					matched =>
						F.pipe(
							matched,
							ExtensionRow,
							O.chain(matched =>
								F.pipe(
									O.Do,
									O.apS("payload", meet(ctx, matched.value, value.payload)),
									O.apS("rest", meetAll(ctx, matched.row, R.Constructors.Empty())),
									O.map(({ payload, rest }) => payload.concat(rest)),
								),
							),
						),
				),
			);
		})
		.with([NF.Patterns.Variant, { type: "Variant" }], ([{ arg }, p]) => meetAll(ctx, p.row, arg.row))
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
