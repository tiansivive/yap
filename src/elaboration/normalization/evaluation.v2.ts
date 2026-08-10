/* eslint-disable no-restricted-syntax, no-restricted-properties, prefer-const, @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion --
 * The NbE machine: evaluation drives an explicit work-stack owned by the callstack effect
 * (./callstack.ts), and shift/reset capture slices that stack for continuations. The driver
 * loop and the remaining unconverted helpers (apply, matching, reduce, force, quote) keep
 * this file's imperative residue; the helpers convert in a later pass.
 */
import { match, P } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from ".";

import { callstack as Stack, Evaluation } from "./callstack";

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

export type EvalOptions = {
	/** no δ-reduction: prevents inlining of definitions. Default is `false`. */
	noInlineBindings?: boolean;
	/** fuel cap: maximum number of evaluation steps before throwing an error. Default is `10,000,000`. */
	maxSteps?: number;
};

/** The evaluation procedure, under the environment the machine is running in. */
export function* evaluate(term: EB.Term, opts: EvalOptions = {}): Evaluation<NF.Value> {
	const ctx = yield* Stack.current();

	return yield* drive(ctx, term, opts);
}

/** The elaboration-facing entry: a fresh machine over the ambient context. */
export function* normalize(term: EB.Term, opts: EvalOptions = {}) {
	const ctx = yield* M.reader.ask();

	const [value] = yield* Eff.with([Stack.handlers(ctx)], () => evaluate(term, opts));

	return value;
}

/** One drive of the machine: schedules term under env and processes its own work. */
function* drive(env: EB.Context, term: EB.Term, opts: EvalOptions = {}): Evaluation<NF.Value> {
	const { noInlineBindings = false, maxSteps = 10000000 } = opts;

	const mark = yield* Stack.begin();
	yield* Stack.with(env, term, noInlineBindings);

	let steps = 0;

	while (true) {
		const step = yield* Stack.next(mark);

		if (!step) {
			break;
		}

		steps++;
		if (steps > maxSteps) {
			throw new Error(`Evaluation exceeded maximum steps (${maxSteps}). Possible infinite loop in: ${EB.Display.Term(term, env)}`);
		}

		yield* match(step)
			.with({ type: "Eval" }, ({ term: tm, noInline }) => evaluateTerm(tm, noInline))
			.with({ type: "Cont" }, ({ k, args }) => k(args))
			.exhaustive();
	}

	return yield* Stack.finish(mark);
}

function* evaluateTerm(term: EB.Term, noInlineBindings: boolean): Evaluation<void> {
	const ctx = yield* Stack.current();

	yield* match(term)
		.with({ type: "Lit" }, function* ({ value }) {
			yield* Stack.ret(NF.Constructors.Lit(value));
		})
		.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
			const sig = ctx.sigma[variable.name];
			if (sig) {
				yield* Stack.ret(sig.value);
				return;
			}

			const rec = ctx.record[variable.name];
			if (rec?.value) {
				yield* Stack.ret(rec.value);
				return;
			}
			if (rec?.term) {
				yield* Stack.eval(rec.term);
				return;
			}

			throw new Error("Unbound label: " + variable.name);
		})
		.with(
			{ type: "Var", variable: { type: "Free" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
			},
		)
		.with({ type: "Var", variable: { type: "Free" } }, function* ({ variable }) {
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

			// Continuation to tie the knot
			yield* Stack.cont(1, function* ([result]) {
				entry.nf = result;
				yield* Stack.ret(result);
			});

			// Evaluate in extended context
			yield* Stack.with(xtended, val[0]);
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* ({ variable }) {
			const registry = yield* Metas.registry.get();
			const solution = Metas.solution(registry, variable.val);

			if (!solution) {
				yield* Stack.ret(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var(variable)));
				return;
			}

			// Force re-evaluation of the solution
			yield* Stack.eval(NF.quote(ctx, ctx.env.length, solution));
		})
		.with(
			{ type: "Var", variable: { type: "Bound" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				const lvl = ctx.env.length - 1 - variable.index;
				yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.Var({ type: "Bound", lvl })));
			},
		)
		.with({ type: "Var", variable: { type: "Bound" } }, function* ({ variable }) {
			const entry = ctx.env[variable.index];
			yield* match(entry.type[0])
				.with({ type: "Mu" }, function* () {
					yield* Stack.ret(NF.Constructors.Neutral("Sealed", entry.nf));
				})
				.otherwise(function* () {
					yield* Stack.ret(entry.nf);
				});
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* ({ variable }) {
			const val = ctx.ffi[variable.name];

			if (!val) {
				yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
				return;
			}

			yield* match(val)
				.with({ arity: 0 }, ffi => Stack.ret(ffi.compute()))
				.otherwise(ffi => Stack.ret(NF.Constructors.External(variable.name, ffi.arity, ffi.compute, [])));
		})
		.with({ type: "Abs", binding: { type: "Lambda" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Lambda
			yield* Stack.cont(1, function* ([ann]) {
				yield* Stack.ret(NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann));
			});
			yield* Stack.eval(binding.annotation);
		})
		.with({ type: "Abs", binding: { type: "Pi" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Pi
			yield* Stack.cont(1, function* ([ann]) {
				yield* Stack.ret(NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body)));
			});
			yield* Stack.eval(binding.annotation);
		})
		.with({ type: "Abs", binding: { type: "Sigma" } }, function* ({ body, binding }) {
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
			yield* Stack.cont(1, function* ([ann]) {
				yield* Stack.ret(NF.Constructors.Sigma(binding.variable, ann, NF.Constructors.Closure(ctx, body)));
			});

			// Evaluate the row
			yield* evalRowPush(xtended, binding.annotation.row);
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, function* (mu) {
			// Evaluate annotation, then construct Mu
			yield* Stack.cont(1, function* ([ann]) {
				yield* Stack.ret(NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body)));
			});
			yield* Stack.eval(mu.binding.annotation);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			// Evaluate func and arg, then reduce
			yield* Stack.cont(2, function* ([funcVal, argVal]) {
				yield* reduceAndPushStack(funcVal, argVal, icit);
			});
			yield* Stack.eval(arg, noInlineBindings);
			yield* Stack.eval(func, noInlineBindings);
		})
		.with({ type: "Row" }, function* ({ row }) {
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

			// Evaluate row and pass the built Row value through
			yield* Stack.cont(1, function* ([rowVal]) {
				yield* Stack.ret(rowVal); // Already a Row value
			});

			yield* evalRowPush(xtended, row);
		})
		.with({ type: "Match" }, function* (v) {
			// Evaluate scrutinee, then match
			yield* Stack.cont(1, function* ([scrutinee]) {
				const known = view(ctx, scrutinee);
				if (known.kind !== "Sealed") {
					yield* Stack.ret(NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee));
					return;
				}

				yield* matchingAndPushStack(ctx, known.value, v.alternatives);
			});
			yield* Stack.eval(v.scrutinee);
		})
		.with({ type: "Proj" }, function* ({ term, label }) {
			// Evaluate base, then project
			yield* Stack.cont(1, function* ([base]) {
				yield* Stack.ret(projectValue(base, label, ctx));
			});
			yield* Stack.eval(term);
		})
		.with({ type: "Inj" }, function* ({ term, label, value: valueTerm }) {
			// Evaluate base and value, then inject
			yield* Stack.cont(2, function* ([base, injected]) {
				yield* Stack.ret(injectValue(base, label, injected, ctx));
			});
			yield* Stack.eval(valueTerm);
			yield* Stack.eval(term);
		})
		.with({ type: "Modal" }, function* ({ term, modalities }) {
			// Evaluate term and liquid, then wrap in Modal
			yield* Stack.cont(2, function* ([nf, liquid]) {
				const result = match(nf)
					.with(NF.Patterns.Modal, ({ modalities: innerModalities, value }) => {
						const combined = Modal.combine(innerModalities, { quantity: modalities.quantity, liquid }, ctx);
						return NF.Constructors.Modal(value, combined);
					})
					.otherwise(v => NF.Constructors.Modal(v, { quantity: modalities.quantity, liquid }));
				yield* Stack.ret(result);
			});
			yield* Stack.eval(modalities.liquid);
			yield* Stack.eval(term);
		})
		.with({ type: "Block" }, function* ({ statements, return: ret }) {
			// Process statements to extend context, then evaluate return
			yield* processStatementsAndPush(statements, ctx, ret);
		})
		.with({ type: "Reset" }, function* ({ term }) {
			// Reset establishes a delimiter for continuation capture.
			yield* Stack.delimit();
			yield* Stack.eval(term);
		})
		.with({ type: "Shift" }, function* ({ body }) {
			// At this point the typing phase has already desugared
			//   shift e
			// into
			//   shift (\k -> e[k])
			// where each `resume v` in `e` became `k v`.
			//
			// Dynamic semantics: capture the continuation up to the nearest
			// Reset-delimiter, package it as a function value, and apply the
			// body-lambda to that continuation.
			yield* Stack.cont(1, function* ([h]) {
				const captured = yield* Stack.capture();
				if (!captured) {
					throw new Error("Shift without enclosing reset");
				}

				// A continuation closure that, when applied to a value v, replays
				// the captured continuation as if resumed at the shift point.
				const continuation: NF.Closure = {
					type: "Continuation",
					frames: captured.frames,
					results: captured.results,
					ctx: captured.env,
					term: EB.Constructors.Lit(Lit.unit()), // dummy term
				};

				const kVal = NF.Constructors.Lambda("kArg", "Explicit", continuation, NF.Any);

				// Apply the desugared handler `h : (A -> R) -> R` to `kVal`.
				yield* reduceAndPushStack(h, kVal, "Explicit");
			});
			// Evaluate the body-lambda; the above continuation receives it.
			yield* Stack.eval(body);
		})
		.with({ type: "Bubble" }, function* ({ meta, shift }) {
			if (yield* Stack.delimited()) {
				yield* Stack.eval(shift);
				return;
			}

			yield* Stack.ret(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Meta", val: meta, lvl: 0 })));
		})
		.with({ type: "Ann" }, function* ({ term }) {
			yield* Stack.eval(term);
		})
		.otherwise(function* (tm) {
			console.log("Eval: Not implemented yet", EB.Display.Term(tm, ctx));
			throw new Error("Not implemented");
		});
}

/**
 * Process block statements, evaluating let bindings and extending context.
 */
function* processStatementsAndPush(stmts: EB.Statement[], ctx: EB.Context, returnTerm: EB.Term): Evaluation<void> {
	if (stmts.length === 0) {
		// No more statements, evaluate the return term
		yield* Stack.with(ctx, returnTerm);
		return;
	}

	const [current, ...rest] = stmts;

	yield* match(current)
		.with({ type: "Let" }, function* ({ variable, annotation, value }) {
			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length }),
				type: [{ type: "Let", variable }, "source", annotation],
				name: { type: "Let", variable },
			};
			const extended = { ...ctx, env: [entry, ...ctx.env] };

			// Process remaining statements after this value is evaluated
			yield* Stack.cont(1, function* ([val]) {
				entry.nf = val;
				yield* processStatementsAndPush(rest, extended, returnTerm);
			});

			// Evaluate the value
			yield* Stack.with(extended, value);
		})
		.with({ type: "Expression" }, function* ({ value }) {
			// Discard the result and continue
			yield* Stack.cont(1, function* ([_val]) {
				yield* processStatementsAndPush(rest, ctx, returnTerm);
			});

			// Evaluate the expression
			yield* Stack.with(ctx, value);
		})
		.with({ type: "Using" }, function* ({ value, annotation }) {
			// no delta-reduction: we don't want to inline the value, just evaluate it and add it to implicits
			const nfValue = yield* drive(ctx, value, { noInlineBindings: true });
			const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([nfValue, annotation]));
			yield* processStatementsAndPush(rest, updated, returnTerm);
		})
		.exhaustive();
}

/**
 * Schedule the evaluation of a row, built up from right to left.
 */
/** Rows complete right-to-left, so a leaf answers through an arity-0 continuation to keep result order. */
function* deferred(value: NF.Value): Evaluation<void> {
	yield* Stack.cont(0, function* () {
		yield* Stack.ret(value);
	});
}

function* evalRowPush(ctx: EB.Context, row: EB.Row): Evaluation<void> {
	yield* match(row)
		.with({ type: "empty" }, r => deferred(NF.Constructors.Row(r)))
		.with({ type: "extension" }, function* ({ label, value: term, row: restRow }) {
			// Evaluate value and rest, then construct extension
			yield* Stack.cont(2, function* ([value, rest]) {
				// rest should be a Row value
				if (rest.type !== "Row") {
					throw new Error("Expected Row value in row evaluation");
				}
				yield* Stack.ret(NF.Constructors.Row(NF.Constructors.Extension(label, value, rest.row)));
			});

			// Schedule rest row evaluation
			yield* evalRowPush(ctx, restRow);

			// Schedule value evaluation (will complete first due to stack order)
			yield* Stack.with(ctx, term);
		})
		.with({ type: "variable" }, function* (r) {
			yield* match(r.variable)
				.with({ type: "Meta" }, function* (v) {
					const registry = yield* Metas.registry.get();
					const solved = Metas.solution(registry, v.val);

					if (!solved) {
						yield* deferred(NF.Constructors.Row({ type: "variable", variable: v }));
						return;
					}

					yield* match(solved)
						.with({ type: "Row" }, deferred)
						.with({ type: "Var" }, ({ variable }) => deferred(NF.Constructors.Row({ type: "variable", variable })))
						.otherwise(nf => {
							throw new Error("Solved meta in row position is not a row or variable: " + NF.display(nf, ctx));
						});
				})
				.with({ type: "Bound" }, function* (v) {
					yield* match(unwrapNeutral(ctx.env[v.index].nf))
						.with({ type: "Row" }, deferred)
						.with({ type: "Var" }, val => deferred(NF.Constructors.Row({ type: "variable", variable: val.variable })))
						.otherwise(val => {
							throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val, ctx));
						});
				})
				.otherwise(v => {
					throw new Error(`Eval Row Variable: Not implemented yet: ${JSON.stringify(v)}`);
				});
		})
		.otherwise(function* () {
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
 * Stack-based reduce: apply function to argument without a nested drive.
 * Inlines apply semantics for the Abs case.
 */
function* reduceAndPushStack(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<void> {
	yield* match(nff)
		.with({ type: "Neutral" }, function* ({ kind, value }) {
			yield* Stack.ret(NF.Constructors.Neutral(kind, NF.Constructors.App(value, nfa, icit)));
		})
		.with({ type: "Modal" }, function* ({ modalities, value }) {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			// Recursively reduce the inner value
			yield* reduceAndPushStack(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* () {
			// Do not unfold mu during normalization - defer to unification
			yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Abs" }, function* ({ closure, binder }) {
			// Closure consumption: the closure's stored environment plus the argument
			const extended = (cls: Exclude<NF.Closure, { type: "Continuation" }>) => {
				if (binder.type !== "Sigma") {
					return EB.extend(cls.ctx, binder, nfa);
				}
				assert(nfa.type === "Row", "Sigma binder should be applied to a Row");
				return EB.extendSigma(cls.ctx, nfa.row);
			};
			yield* match(closure)
				.with({ type: "Closure" }, function* (cls) {
					yield* Stack.with(extended(cls), cls.term);
				})
				.with({ type: "PrimOp" }, function* (primop) {
					const args = extended(primop)
						.env.slice(0, primop.arity)
						.map(({ nf }) => nf);
					yield* Stack.ret(primop.compute(...args));
				})
				.with({ type: "Continuation" }, function* (cont) {
					// Replay the captured continuation with the argument at the shift point.
					yield* Stack.resume({ frames: cont.frames, results: cont.results, env: cont.ctx }, nfa);
				})
				.exhaustive();
		})
		.with({ type: "Lit", value: { type: "Atom" } }, function* ({ value }) {
			yield* Stack.ret(NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit));
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* () {
			yield* Stack.ret(NF.Constructors.Neutral("Symbolic", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* () {
			yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "App" }, function* ({ func, arg, icit: argIcit }) {
			// Reduce func to arg first, then apply result to nfa
			// This is a recursive reduction, not evaluation
			const intermediate = reduce(func, arg, argIcit);
			yield* reduceAndPushStack(intermediate, nfa, icit);
		})
		.with({ type: "External" }, function* ({ name, args, arity, compute }) {
			if (arity === 0) {
				yield* Stack.ret(compute());
				return;
			}

			const accumulated = [...args, nfa];

			if (accumulated.length < arity) {
				yield* Stack.ret(NF.Constructors.External(name, arity, compute, accumulated));
				return;
			}

			if (accumulated.some(a => a.type === "Neutral")) {
				yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.External(name, arity, compute, accumulated)));
				return;
			}

			yield* Stack.ret(compute(...accumulated.map(ignoraModal)));
		})
		.otherwise(function* () {
			throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
		});
}

/**
 * Stack-based matching: push alternatives as work items instead of recursively calling evaluate.
 */
function* matchingAndPushStack(ctx: EB.Context, nf: NF.Value, alts: EB.Alternative[]): Evaluation<void> {
	if (alts.length === 0) {
		throw new Error("Match: No alternative matched");
	}

	const [alt, ...rest] = alts;
	const meetResult = meet(ctx, alt.pattern, nf);

	if (O.isSome(meetResult)) {
		// Pattern matched: enter the alternative under the binder-extended context
		const binders = meetResult.value;
		const extendedCtx = binders.reduce((_ctx, { binder, nf }) => EB.extend(_ctx, binder, nf), ctx);
		yield* Stack.with(extendedCtx, alt.term);
	} else {
		// Pattern didn't match: try next alternative
		yield* matchingAndPushStack(ctx, nf, rest);
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
