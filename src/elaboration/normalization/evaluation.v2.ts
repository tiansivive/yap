/* eslint-disable no-restricted-syntax, no-restricted-properties, @typescript-eslint/no-unused-vars --
 * The NbE machine: evaluation drives an explicit work-stack owned by the callstack effect
 * (./callstack.ts), and shift/reset capture slices that stack for continuations. The driver
 * loop is the intentional CEK core: mutation stays private to the machine-owning handler.
 */
import { match, P } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "./syntax/term";
import { display } from "./syntax/pretty";

import { callstack as Stack, Mode, Evaluation, Mark } from "./callstack";
import * as Quoting from "./quoting";

import _ from "lodash";

import * as E from "fp-ts/lib/Either";
import * as R from "@yap/shared/rows";
import { Option } from "fp-ts/lib/Option";
import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/Array";
import * as Modal from "@yap/verification/modalities/shared";
import { Implicitness } from "@yap/shared/implicitness";
import { update } from "@yap/utils";
import assert from "assert";

import * as Lit from "@yap/shared/literals";

/** Default fuel cap for a drive; exceeding it throws. */
export const MAX_STEPS = 10_000_000;

/** Crash messages are plain expressions: a boundary run over snapshots, like any other boundary. */
const shown = (ctx: EB.Context, program: () => ReturnType<typeof display>): string =>
	Eff.run(program, [M.reader.handlers(ctx), Metas.registry.handlers({})])[0];

export type EvalOptions = {
	/** fuel cap: maximum number of evaluation steps before throwing an error. Default is `MAX_STEPS`. */
	maxSteps?: number;
};

/** The evaluation procedure: one marked drive on the ambient machine, under the ambient env. */
export function* evaluate(term: EB.Term, opts: EvalOptions = {}): Evaluation<NF.Value> {
	const { maxSteps = MAX_STEPS } = opts;
	const ctx = yield* M.reader.ask();

	const mark = yield* Stack.begin();
	yield* Stack.eval(term);
	yield* drain(mark, maxSteps, () => `Evaluation exceeded maximum steps (${maxSteps}). Possible infinite loop in: ${shown(ctx, () => EB.Display.Term(term))}`);

	return yield* Stack.finish(mark);
}

/** Processes a drive's work to exhaustion. */
function* drain(mark: Mark, maxSteps: number, blame: () => string): Evaluation<void> {
	let steps = 0;

	while (true) {
		const step = yield* Stack.next(mark);

		if (!step) {
			break;
		}

		steps++;
		if (steps > maxSteps) {
			throw new Error(blame());
		}

		/* The driver re-binds the reader per step: the frame's env is the single authority. */
		yield* match(step)
			.with({ type: "Eval" }, ({ env: scope, term: tm }) => M.reader.local(_ => scope, evaluateTerm(tm)))
			.with({ type: "Cont" }, ({ env: scope, k, args }) => M.reader.local(_ => scope, k(args)))
			.exhaustive();
	}
}

function* evaluateTerm(term: EB.Term): Evaluation<void> {
	const ctx = yield* M.reader.ask();
	const { noInlineBindings, noReduceEliminations } = yield* Mode.ask();

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
			yield* M.reader.local(_ => xtended, Stack.eval(val[0]));
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* ({ variable }) {
			const registry = yield* Metas.registry.get();
			const solution = Metas.solution(registry, variable.val);

			if (!solution) {
				yield* Stack.ret(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var(variable)));
				return;
			}

			// Force re-evaluation of the solution
			yield* Stack.eval(yield* Quoting.quote(ctx.env.length, solution));
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
			yield* M.reader.local(_ => xtended, evalRowPush(binding.annotation.row));
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
			yield* Stack.eval(arg);
			yield* Stack.eval(func);
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

			yield* M.reader.local(_ => xtended, evalRowPush(row));
		})
		.with(
			{ type: "Match" },
			() => noReduceEliminations,
			function* (v: EB.Term & { type: "Match" }) {
				yield* Stack.cont(1, function* ([scrutinee]) {
					yield* Stack.ret(NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee));
				});
				yield* Stack.eval(v.scrutinee);
			},
		)
		.with({ type: "Match" }, function* (v) {
			yield* Stack.cont(1, function* ([scrutinee]) {
				yield* matchingAndPushStack(scrutinee, v.alternatives, NF.Constructors.Closure(ctx, v));
			});
			yield* Stack.eval(v.scrutinee);
		})
		.with(
			{ type: "Proj" },
			() => noReduceEliminations,
			function* ({ term, label }: EB.Term & { type: "Proj" }) {
				yield* Stack.cont(1, function* ([base]) {
					yield* Stack.ret(NF.Constructors.StuckProj(base, label));
				});
				yield* Stack.eval(term);
			},
		)
		.with({ type: "Proj" }, function* ({ term, label }) {
			yield* Stack.cont(1, function* ([base]) {
				yield* Stack.ret(yield* projectValue(base, label));
			});
			yield* Stack.eval(term);
		})
		.with(
			{ type: "Inj" },
			() => noReduceEliminations,
			function* ({ term, label, value: valueTerm }: EB.Term & { type: "Inj" }) {
				yield* Stack.cont(2, function* ([base, injected]) {
					yield* Stack.ret(NF.Constructors.StuckInj(base, label, injected));
				});
				yield* Stack.eval(valueTerm);
				yield* Stack.eval(term);
			},
		)
		.with({ type: "Inj" }, function* ({ term, label, value: valueTerm }) {
			yield* Stack.cont(2, function* ([base, injected]) {
				yield* Stack.ret(yield* injectValue(base, label, injected));
			});
			yield* Stack.eval(valueTerm);
			yield* Stack.eval(term);
		})
		.with({ type: "Modal" }, function* ({ term, modalities }) {
			// Evaluate term and liquid, then wrap in Modal
			yield* Stack.cont(2, function* ([nf, liquid]) {
				const result = yield* match(nf)
					.with(NF.Patterns.Modal, function* ({ modalities: innerModalities, value }) {
						const combined = yield* Modal.combine(innerModalities, { quantity: modalities.quantity, liquid });
						return NF.Constructors.Modal(value, combined);
					})
					.otherwise(function* (v) {
						return NF.Constructors.Modal(v, { quantity: modalities.quantity, liquid });
					});
				yield* Stack.ret(result);
			});
			yield* Stack.eval(modalities.liquid);
			yield* Stack.eval(term);
		})
		.with({ type: "Block" }, function* ({ statements, return: ret }) {
			// Process statements to extend context, then evaluate return
			yield* processStatementsAndPush(statements, ret);
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
			console.log(
				"Eval: Not implemented yet",
				shown(ctx, () => EB.Display.Term(tm)),
			);
			throw new Error("Not implemented");
		});
}

/**
 * Process block statements, evaluating let bindings and extending context.
 */
function* processStatementsAndPush(stmts: EB.Statement[], returnTerm: EB.Term): Evaluation<void> {
	if (stmts.length === 0) {
		// No more statements, evaluate the return term
		yield* Stack.eval(returnTerm);
		return;
	}

	const ctx = yield* M.reader.ask();
	const [current, ...rest] = stmts;

	yield* match(current)
		.with({ type: "Let" }, function* ({ variable, annotation, value }) {
			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length }),
				type: [{ type: "Let", variable }, "source", annotation],
				name: { type: "Let", variable },
			};
			const extended = { ...ctx, env: [entry, ...ctx.env] };

			yield* M.reader.local(
				_ => extended,
				(function* () {
					// Process remaining statements after this value is evaluated
					yield* Stack.cont(1, function* ([val]) {
						entry.nf = val;
						yield* processStatementsAndPush(rest, returnTerm);
					});

					// Evaluate the value
					yield* Stack.eval(value);
				})(),
			);
		})
		.with({ type: "Expression" }, function* ({ value }) {
			// Discard the result and continue
			yield* Stack.cont(1, function* ([_val]) {
				yield* processStatementsAndPush(rest, returnTerm);
			});

			// Evaluate the expression
			yield* Stack.eval(value);
		})
		.with({ type: "Using" }, function* ({ value, annotation }) {
			// no δ-reduction: we don't want to inline the value, just evaluate it and add it to implicits
			const nfValue = yield* Mode.local(m => ({ ...m, noInlineBindings: true }), evaluate(value));
			const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([nfValue, annotation]));
			yield* M.reader.local(_ => updated, processStatementsAndPush(rest, returnTerm));
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

function* evalRowPush(row: EB.Row): Evaluation<void> {
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
			yield* evalRowPush(restRow);

			// Schedule value evaluation (will complete first due to stack order)
			yield* Stack.eval(term);
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

					const ctx = yield* M.reader.ask();

					yield* match(solved)
						.with({ type: "Row" }, deferred)
						/*
						 * A solution naming a variable is a reference, not an answer: the slot it
						 * names is where instantiation installs the use site's fresh meta. Quoting
						 * back to syntax and re-evaluating resolves it against the current scope,
						 * exactly as the value path does for a solved meta.
						 */
						.with({ type: "Var" }, function* ({ variable }) {
							yield* Stack.eval(yield* Quoting.quote(ctx.env.length, NF.Constructors.Row({ type: "variable", variable })));
						})
						.otherwise(nf => {
							throw new Error("Solved meta in row position is not a row or variable: " + shown(ctx, () => display(nf)));
						});
				})
				.with({ type: "Bound" }, function* (v) {
					const ctx = yield* M.reader.ask();

					yield* match(unwrapNeutral(ctx.env[v.index].nf))
						.with({ type: "Row" }, deferred)
						.with({ type: "Var" }, val => deferred(NF.Constructors.Row({ type: "variable", variable: val.variable })))
						.otherwise(val => {
							throw new Error("Evaluating a row variable that is not a row or a variable: " + shown(ctx, () => display(val)));
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

const project = function* (base: NF.Value, label: string): Evaluation<Project> {
	const ctx = yield* M.reader.ask();

	const current = match(base)
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, ({ value }) => ctx.sigma[value.variable.name]?.value ?? base)
		.otherwise(() => base);

	const lookup = (row: NF.Row): Project =>
		match(row)
			.with({ type: "empty" }, (): Project => ({ tag: "missing" }))
			.with({ type: "variable" }, (): Project => ({ tag: "blocked" }))
			.with({ type: "extension" }, ({ label: current, value, row }) => (current === label ? ({ tag: "found", value } satisfies Project) : lookup(row)))
			.exhaustive();

	return match(yield* view(current))
		.with({ kind: "Symbolic" }, (): Project => ({ tag: "blocked" }))
		.with({ kind: "Blocked" }, (): Project => ({ tag: "blocked" }))
		.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => lookup(value.row))
		.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) => lookup(value.arg.row))
		.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) => lookup(value.arg.row))
		.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) => lookup(value.arg.row))
		.otherwise((): Project => ({ tag: "not-applicable" }));
};

function* projectValue(base: NF.Value, label: string): Evaluation<NF.Value> {
	return match(yield* project(base, label))
		.with({ tag: "found" }, ({ value }) => value)
		.with({ tag: "missing" }, () => {
			throw new Error(`Projection: label ${label} not found`);
		})
		.otherwise(() => NF.Constructors.StuckProj(base, label));
}

const inject = function* (base: NF.Value, label: string, injected: NF.Value): Evaluation<NF.Value | undefined> {
	const set = (row: NF.Row): NF.Row =>
		match(row)
			.with({ type: "empty" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "variable" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "extension" }, ({ label: current, value, row }) =>
				current === label ? NF.Constructors.Extension(label, injected, row) : NF.Constructors.Extension(current, value, set(row)),
			)
			.exhaustive();

	return match(yield* view(base))
		.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => NF.Constructors.Row(set(value.row)))
		.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) => NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit))
		.otherwise(() => undefined);
};

function* injectValue(base: NF.Value, label: string, injected: NF.Value): Evaluation<NF.Value> {
	return (yield* inject(base, label, injected)) ?? NF.Constructors.StuckInj(base, label, injected);
}

/**
 * Stack-based reduce: apply function to argument without a nested drive.
 * Inlines apply semantics for the Abs case.
 */
function* reduceAndPushStack(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<void> {
	yield* match(nff)
		.with({ type: "Neutral", kind: "Sealed" }, function* ({ value }) {
			yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.App(value, nfa, icit)));
		})
		.with({ type: "Neutral", kind: "Symbolic" }, function* () {
			yield* Stack.ret(NF.Constructors.Neutral("Blocked", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "Neutral", kind: "Blocked" }, function* ({ value }) {
			yield* Stack.ret(NF.Constructors.Neutral("Blocked", NF.Constructors.App(value, nfa, icit)));
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
			const extended = (cls: Exclude<NF.Closure, { type: "Continuation" }>) => {
				if (binder.type !== "Sigma") {
					return EB.extend(cls.ctx, binder, nfa);
				}
				assert(nfa.type === "Row", "Sigma binder should be applied to a Row");
				return EB.extendSigma(cls.ctx, nfa.row);
			};
			yield* match(closure)
				.with({ type: "Closure" }, cls => M.reader.local(_ => extended(cls), Stack.eval(cls.term)))
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
			const symbolic = NF.Constructors.Neutral("Symbolic", nff);
			yield* Stack.ret(NF.Constructors.Neutral("Blocked", NF.Constructors.App(symbolic, nfa, icit)));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* () {
			yield* Stack.ret(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
		})
		.with({ type: "App" }, function* ({ func, arg, icit: argIcit }) {
			// Reduce func to arg first, then apply result to nfa
			// This is a recursive reduction, not evaluation
			const intermediate = yield* reduce(func, arg, argIcit);
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

			if (accumulated.some(blocksExternal)) {
				yield* Stack.ret(NF.Constructors.Neutral("Blocked", NF.Constructors.External(name, arity, compute, accumulated)));
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
function* matchingAndPushStack(nf: NF.Value, alts: EB.Alternative[], closure: NF.Closure): Evaluation<void> {
	if (alts.length === 0) {
		throw new Error("Match: No alternative matched");
	}

	const ctx = yield* M.reader.ask();
	const [alt, ...rest] = alts;
	const meetResult = yield* meet(ctx, alt.pattern, nf);

	yield* match(meetResult)
		.with({ tag: "matched" }, function* ({ bindings }) {
			const extendedCtx = bindings.reduce((_ctx, { binder, nf: bound }) => EB.extend(_ctx, binder, bound), ctx);
			yield* M.reader.local(_ => extendedCtx, Stack.eval(alt.term));
		})
		.with({ tag: "blocked" }, function* () {
			yield* Stack.ret(NF.Constructors.StuckMatch(closure, nf));
		})
		.with({ tag: "mismatch" }, function* () {
			yield* matchingAndPushStack(nf, rest, closure);
		})
		.exhaustive();
}

export function* reduce(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<NF.Value> {
	return yield* match(nff)
		.with({ type: "Neutral", kind: "Sealed" }, function* ({ value }) {
			return NF.Constructors.Neutral("Sealed", NF.Constructors.App(value, nfa, icit));
		})
		.with({ type: "Neutral", kind: "Symbolic" }, function* () {
			return NF.Constructors.Neutral("Blocked", NF.Constructors.App(nff, nfa, icit));
		})
		.with({ type: "Neutral", kind: "Blocked" }, function* ({ value }) {
			return NF.Constructors.Neutral("Blocked", NF.Constructors.App(value, nfa, icit));
		})
		.with({ type: "Modal" }, function* ({ modalities, value }) {
			console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
			return yield* reduce(value, nfa, icit);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* (mu) {
			// Do not unfold mu during normalization - defer to unification
			return NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit));
		})
		.with({ type: "Abs" }, function* ({ closure, binder }) {
			return yield* apply(binder, closure, nfa);
		})
		.with({ type: "Lit", value: { type: "Atom" } }, function* ({ value }) {
			return NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit);
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* (_) {
			const symbolic = NF.Constructors.Neutral("Symbolic", nff);
			return NF.Constructors.Neutral("Blocked", NF.Constructors.App(symbolic, nfa, icit));
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* () {
			return NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit));
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			const nff = yield* reduce(func, arg, icit);
			return NF.Constructors.App(nff, nfa, icit);
		})
		.with({ type: "External" }, function* ({ name, args, arity, compute }) {
			if (arity === 0) {
				return compute();
			}

			const accumulated = [...args, nfa];

			if (accumulated.length < arity) {
				return NF.Constructors.External(name, arity, compute, accumulated);
			}

			if (accumulated.some(blocksExternal)) {
				return NF.Constructors.Neutral("Blocked", NF.Constructors.External(name, arity, compute, accumulated));
			}

			return compute(...accumulated.map(ignoraModal));
		})
		.otherwise(function* () {
			throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
		});
}

export function* matching(nf: NF.Value, alts: EB.Alternative[]): Evaluation<NF.Value | undefined> {
	if (alts.length === 0) {
		throw new Error("Match: No alternative matched");
	}

	const ctx = yield* M.reader.ask();
	const [alt, ...rest] = alts;
	const met = yield* meet(ctx, alt.pattern, nf);

	return yield* match(met)
		.with({ tag: "blocked" }, function* () {
			return undefined;
		})
		.with({ tag: "mismatch" }, function* () {
			return yield* matching(nf, rest);
		})
		.with({ tag: "matched" }, function* ({ bindings }) {
			const extended = bindings.reduce((_ctx, { binder, nf: bound }) => EB.extend(_ctx, binder, bound), ctx);
			return yield* M.reader.local(_ => extended, evaluate(alt.term));
		})
		.exhaustive();
}

export function* apply(binder: EB.Binder, closure: NF.Closure, value: NF.Value): Evaluation<NF.Value> {
	// A captured continuation: replay it with the value at the shift point.
	if (closure.type === "Continuation") {
		const mark = yield* Stack.begin();
		yield* Stack.resume({ frames: closure.frames, results: closure.results, env: closure.ctx }, value);
		yield* drain(mark, MAX_STEPS, () => `Continuation replay exceeded maximum steps`);

		return yield* Stack.finish(mark);
	}

	// Closure consumption: the closure's stored environment plus the argument.
	const extended = (() => {
		if (binder.type !== "Sigma") {
			return EB.extend(closure.ctx, binder, value);
		}
		assert(value.type === "Row", "Sigma binder should be applied to a Row");
		return EB.extendSigma(closure.ctx, value.row);
	})();

	if (closure.type === "Closure") {
		return yield* M.reader.local(_ => extended, evaluate(closure.term));
	}

	const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
	return closure.compute(...args);
}

export type View = { kind: NF.Neutral; value: NF.Value };

export function* resume(value: NF.Value): Evaluation<Option<NF.Value>> {
	return yield* match(value)
		.with(NF.Patterns.Proj, function* ({ base, label }) {
			return match(yield* project(base, label))
				.with({ tag: "found" }, ({ value: found }) => O.some(found))
				.with({ tag: "missing" }, () => {
					throw new Error(`Projection: label ${label} not found`);
				})
				.otherwise(() => O.none);
		})
		.with(NF.Patterns.Match, function* ({ closure, scrutinee }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			const result = yield* M.reader.local(_ => closure.ctx, matching(scrutinee, closure.term.alternatives));
			return O.fromNullable(result);
		})
		.with(NF.Patterns.Inj, function* ({ base, label, injected }) {
			return O.fromNullable(yield* inject(base, label, injected));
		})
		.with(NF.Patterns.App, function* ({ func, arg, icit: appIcit }) {
			const forced = yield* force(func);

			if (forced === func) {
				return O.none;
			}
			return O.some(yield* reduce(forced, arg, appIcit));
		})
		.with({ type: "External" }, function* (ext) {
			if (ext.args.length < ext.arity) {
				return O.none;
			}

			const forced = yield* Eff.traverse(ext.args, force);
			const changed = forced.some((arg, index) => arg !== ext.args[index]);

			if (forced.some(blocksExternal)) {
				return changed ? O.some(NF.Constructors.Neutral("Blocked", NF.Constructors.External(ext.name, ext.arity, ext.compute, forced))) : O.none;
			}

			return O.some(ext.compute(...forced.map(ignoraModal)));
		})
		.otherwise(function* () {
			return O.none;
		});
}

export function* force(value: NF.Value): Evaluation<NF.Value> {
	return yield* match(value)
		.with({ type: "Neutral", kind: "Sealed" }, function* () {
			return value;
		})
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, function* ({ value: label }) {
			const ctx = yield* M.reader.ask();

			return yield* match(ctx.sigma[label.variable.name])
				.with({ value: { type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label } }, function* ({ value: placeholder }) {
					return placeholder.value.variable.name === label.variable.name ? value : yield* force(placeholder);
				})
				.with({ value: P.select() }, function* (resolved) {
					return yield* force(resolved);
				})
				.otherwise(function* () {
					return value;
				});
		})
		.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Flex }, function* ({ value: flex }) {
			const solution = Metas.solution(yield* Metas.registry.get(), flex.variable.val);

			return solution ? yield* force(solution) : value;
		})
		.with({ type: "Neutral", kind: "Symbolic" }, function* () {
			return value;
		})
		.with({ type: "Neutral", kind: "Blocked" }, function* ({ value: blocked }) {
			const next = yield* resume(blocked);

			return O.isNone(next) ? value : yield* force(next.value);
		})
		.with(NF.Patterns.Flex, function* ({ variable }) {
			const solution = Metas.solution(yield* Metas.registry.get(), variable.val);

			return solution ? yield* force(solution) : value;
		})
		.otherwise(function* () {
			const next = yield* resume(value);

			return O.isNone(next) ? value : yield* force(next.value);
		});
}

export function* view(value: NF.Value): Evaluation<View> {
	const forced = yield* force(value);

	return match(forced)
		.with({ type: "Neutral" }, ({ kind, value }) => ({ kind, value }))
		.otherwise(value => ({ kind: "Sealed", value }));
}

/*
 * Strips the wrappers that carry no structural content: Symbolic marks an unknown,
 * Sealed protects a concrete value, and under either sits the value itself. Blocked
 * stays — it is the only thing distinguishing a suspended elimination from a
 * reducible one, so consumers match it through the Stuck* patterns.
 */
export const unwrapNeutral = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Neutral", kind: P.union("Symbolic", "Sealed") }, ({ value }) => unwrapNeutral(value))
		.otherwise(() => value);
};

/** Whether a value is an unsolved meta once the informationless wrappers are off. Recursive peeling, so no finite pattern expresses it. */
export const isFlex = (value: NF.Value): boolean =>
	match(unwrapNeutral(value))
		.with(NF.Patterns.Flex, () => true)
		.otherwise(() => false);

export const ignoraModal = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Modal" }, ({ value }) => ignoraModal(value))
		.otherwise(() => value);
};

const blocksExternal = (value: NF.Value): boolean =>
	match(ignoraModal(value))
		.with(NF.Patterns.Unresolved, () => true)
		.otherwise(() => false);

export const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];

export type MeetResult = { binder: EB.Binder; nf: NF.Value };
export type Meet = { tag: "matched"; bindings: MeetResult[] } | { tag: "mismatch" } | { tag: "blocked" };

const matched = (bindings: MeetResult[]): Meet => ({ tag: "matched", bindings });
const mismatch = (): Meet => ({ tag: "mismatch" });
const blocked = (): Meet => ({ tag: "blocked" });

const combineMeet = (left: Meet, right: Meet): Meet =>
	match([left, right])
		.with([{ tag: "mismatch" }, P._], [P._, { tag: "mismatch" }], mismatch)
		.with([{ tag: "blocked" }, P._], [P._, { tag: "blocked" }], blocked)
		.with([{ tag: "matched" }, { tag: "matched" }], ([l, r]) => matched([...l.bindings, ...r.bindings]))
		.exhaustive();

export function* meet(ctx: EB.Context, pattern: EB.Pattern, nf: NF.Value): Evaluation<Meet> {
	const immediate = match(pattern)
		.with({ type: "Wildcard" }, () => matched([]))
		.with({ type: "Binder" }, ({ value }) => {
			const binder: EB.Binder = { type: "Lambda", variable: value };
			return matched([{ binder, nf }]);
		})
		.otherwise(() => undefined);

	if (immediate) {
		return immediate;
	}

	const known = yield* view(nf);
	if (known.kind !== "Sealed") {
		return blocked();
	}

	return yield* match([known.value, pattern])
		.with([{ type: "Neutral" }, P._], function* () {
			return blocked();
		})
		.with([{ type: "Lit" }, { type: "Lit" }], function* ([value, p]) {
			return _.isEqual(value.value, p.value) ? matched([]) : mismatch();
		})
		.with(
			[NF.Patterns.Array, { type: "List" }],
			([value, p]) => value.arg.row.type === "empty" && p.patterns.length === 0 && !p.rest,
			function* () {
				return matched([]);
			},
		)
		.with(
			[NF.Patterns.Array, { type: "List" }],
			([, p]) => p.patterns.length === 0 && !p.rest,
			function* () {
				return mismatch();
			},
		)
		.with([NF.Patterns.Array, { type: "List" }], function* ([value, p]) {
			const zip = function* (patterns: EB.Pattern[], row: NF.Row): Evaluation<Meet> {
				if (patterns.length === 0) {
					if (!p.rest) {
						return matched([]);
					}

					const binder: EB.Binder = { type: "Lambda", variable: p.rest };
					return matched([{ binder, nf: NF.Constructors.Array(row) }]);
				}

				if (row.type !== "extension") {
					return mismatch();
				}

				const [head, ...tail] = patterns;
				const current = yield* meet(ctx, head, row.value);
				const rest = yield* zip(tail, row.row);
				return combineMeet(current, rest);
			};

			return yield* zip(p.patterns, value.arg.row);
		})
		.with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], function* ([{ arg }, p]) {
			return yield* meetAll(ctx, p.row, arg.row);
		})
		.with([NF.Patterns.Row, { type: "Row" }], function* ([value, p]) {
			return yield* meetAll(ctx, p.row, value.row);
		})
		.with([NF.Patterns.Tagged, { type: "Variant", row: { type: "extension" } }], function* ([{ arg }, p]) {
			const value = NF.TaggedValue.extract(arg.row);
			if (!value) {
				return mismatch();
			}

			const rewritten = R.rewrite(p.row, value.label);
			if (E.isLeft(rewritten) || rewritten.right.type !== "extension") {
				return mismatch();
			}

			const payload = yield* meet(ctx, rewritten.right.value, value.payload);
			const rest = yield* meetAll(ctx, rewritten.right.row, R.Constructors.Empty());
			return combineMeet(payload, rest);
		})
		.with([NF.Patterns.Variant, { type: "Variant" }], function* ([{ arg }, p]) {
			return yield* meetAll(ctx, p.row, arg.row);
		})
		.with([NF.Patterns.HashMap, { type: "List" }], function* () {
			console.warn("List pattern matching not yet implemented");
			return matched([]);
		})
		.with([NF.Patterns.Atom, { type: "Var" }], function* ([{ value }, p]) {
			return value.value === p.value ? matched([]) : mismatch();
		})
		.otherwise(function* () {
			return mismatch();
		});
}

const meetAll = function* (ctx: EB.Context, pats: R.Row<EB.Pattern, string>, vals: NF.Row): Evaluation<Meet> {
	return yield* match([pats, vals])
		.with([{ type: "empty" }, P._], function* () {
			return matched([]);
		})
		.with([{ type: "variable" }, P._], function* ([r, tail]) {
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return matched([{ binder, nf: NF.Constructors.Row(tail) }]);
		})
		.with([{ type: "extension" }, { type: "empty" }], [{ type: "extension" }, { type: "variable" }], function* () {
			return mismatch();
		})
		.with([{ type: "extension" }, { type: "extension" }], function* ([r1, r2]) {
			const rewritten = R.rewrite(r2, r1.label);
			if (E.isLeft(rewritten)) {
				return mismatch();
			}

			if (rewritten.right.type !== "extension") {
				throw new Error("Rewriting a row extension should result in another row extension");
			}

			const current = yield* meet(ctx, r1.value, rewritten.right.value);
			const rest = yield* meetAll(ctx, r1.row, rewritten.right.row);
			return combineMeet(current, rest);
		})
		.exhaustive();
};
