/* eslint-disable no-restricted-syntax, no-restricted-properties --
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
import * as DSL from "./syntax/dsl";
import { display } from "./syntax/pretty";

import { callstack as Stack, Frame, Mode, Evaluation, Mark } from "./callstack";
import { Do } from "./do";
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
import * as Q from "@yap/shared/modalities/multiplicity";

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

	return yield* drive(
		Frame.eval(term),
		maxSteps,
		() => `Evaluation exceeded maximum steps (${maxSteps}). Possible infinite loop in: ${shown(ctx, () => EB.Display.Term(term))}`,
	);
}

/**
 * A marked drive: schedule the work, run it to exhaustion, take its single answer.
 * Reading a value out of the machine costs a level of host recursion, so this is a
 * boundary operation — the evaluation path schedules instead, and `schedule` is the
 * canonical form every operation here is written in.
 */
export function* drive<A = NF.Value>(work: Evaluation<void>, maxSteps: number, blame: () => string): Evaluation<A> {
	const mark = yield* Stack.begin();
	yield* work;
	yield* drain(mark, maxSteps, blame);

	return yield* Stack.finish<A>(mark);
}

/**
 * Processes a drive's work to exhaustion. The budget it enforces is the machine's, so a
 * cycle whose steps are spread across nested drives still reaches the cap and is blamed on
 * the term that diverged, instead of running until the host stack gives out.
 */
function* drain(mark: Mark, maxSteps: number, blame: () => string): Evaluation<void> {
	while (true) {
		const step = yield* Stack.next(mark);

		if (!step) {
			break;
		}

		if (step.spent > maxSteps) {
			throw new Error(blame());
		}

		/* The driver re-binds both readers per step: the frame's env and mode are the single authority. */
		yield* match(step)
			.with({ type: "Eval" }, ({ env: scope, mode, term: tm }) =>
				M.reader.local(
					_ => scope,
					Mode.local(_ => mode, evaluateTerm(tm)),
				),
			)
			.with({ type: "Cont" }, ({ env: scope, mode, k, args }) =>
				M.reader.local(
					_ => scope,
					Mode.local(_ => mode, k(args)),
				),
			)
			.exhaustive();
	}
}

function* evaluateTerm(term: EB.Term): Evaluation<void> {
	const ctx = yield* M.reader.ask();
	const { noInlineBindings, noReduceEliminations } = yield* Mode.ask();

	yield* match(term)
		.with({ type: "Lit" }, function* ({ value }) {
			yield* Frame.of(NF.Constructors.Lit(value));
		})
		.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
			const sig = ctx.sigma[variable.name];
			if (sig) {
				yield* Frame.of(sig.value);
				return;
			}

			const rec = ctx.record[variable.name];
			if (rec?.value) {
				yield* Frame.of(rec.value);
				return;
			}
			if (rec?.term) {
				yield* Frame.eval(rec.term);
				return;
			}

			throw new Error("Unbound label: " + variable.name);
		})
		.with(
			{ type: "Var", variable: { type: "Free" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
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

			// Tie the knot: the entry sees the value it evaluates to
			yield* Do.bind("result", () => M.reader.local(_ => xtended, Frame.eval(val[0]))).chain(function* ({ result }) {
				entry.nf = result;

				yield* Frame.of("value", result);
			});
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* ({ variable }) {
			const registry = yield* Metas.registry.get();
			const solution = Metas.solution(registry, variable.val);

			if (!solution) {
				yield* Frame.of(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var(variable)));
				return;
			}

			// Force re-evaluation of the solution
			yield* Do.bind("quotation", "quoted", () => Quoting.quote(ctx.env.length, solution)).chain(({ quoted }) => Frame.eval(quoted));
		})
		.with(
			{ type: "Var", variable: { type: "Bound" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				const lvl = ctx.env.length - 1 - variable.index;
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.Var({ type: "Bound", lvl })));
			},
		)
		.with({ type: "Var", variable: { type: "Bound" } }, function* ({ variable }) {
			const entry = ctx.env[variable.index];
			yield* match(entry.type[0])
				.with({ type: "Mu" }, function* () {
					yield* Frame.of(NF.Constructors.Neutral("Sealed", entry.nf));
				})
				.otherwise(function* () {
					yield* Frame.of(entry.nf);
				});
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* ({ variable }) {
			const val = ctx.ffi[variable.name];

			if (!val) {
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
				return;
			}

			yield* match(val)
				.with({ arity: 0 }, ffi => Frame.of(ffi.compute()))
				.otherwise(ffi => Frame.of(NF.Constructors.External(variable.name, ffi.arity, ffi.compute, [])));
		})
		.with({ type: "Abs", binding: { type: "Lambda" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Lambda
			yield* Do.bind("ann", () => Frame.eval(binding.annotation)).chain(({ ann }) =>
				Frame.of("value", NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann)),
			);
		})
		.with({ type: "Abs", binding: { type: "Pi" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Pi
			yield* Do.bind("ann", () => Frame.eval(binding.annotation)).chain(({ ann }) =>
				Frame.of("value", NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body))),
			);
		})
		.with({ type: "Abs", binding: { type: "Sigma" } }, function* ({ body, binding }) {
			assert(binding.annotation.type === "Row", "Sigma binder annotation must be a Row");
			const annotation = binding.annotation.row;

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
			yield* Do.bind("ann", () => M.reader.local(_ => xtended, evalRowPush(annotation))).chain(({ ann }) =>
				Frame.of("value", NF.Constructors.Sigma(binding.variable, ann, NF.Constructors.Closure(ctx, body))),
			);
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, function* (mu) {
			// Evaluate annotation, then construct Mu
			yield* Do.bind("ann", () => Frame.eval(mu.binding.annotation)).chain(({ ann }) =>
				Frame.of("value", NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body))),
			);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			// Evaluate func and arg, then reduce
			yield* Do.bind("funcVal", () => Frame.eval(func))
				.bind("argVal", () => Frame.eval(arg))
				.chain(({ funcVal, argVal }) => schedule.reduce(funcVal, argVal, icit));
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

			/* The row builds its own value; this only re-binds the scope the fields are evaluated in. */
			yield* M.reader.local(_ => xtended, evalRowPush(row));
		})
		.with(
			{ type: "Match" },
			() => noReduceEliminations,
			function* (v: EB.Term & { type: "Match" }) {
				yield* Do.bind("scrutinee", () => Frame.eval(v.scrutinee)).chain(({ scrutinee }) =>
					Frame.of("value", NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee)),
				);
			},
		)
		.with({ type: "Match" }, function* (v) {
			yield* Do.bind("scrutinee", () => Frame.eval(v.scrutinee)).chain(({ scrutinee }) =>
				schedule.matching(scrutinee, v.alternatives, NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee)),
			);
		})
		.with(
			{ type: "Proj" },
			() => noReduceEliminations,
			function* ({ term, label }: EB.Term & { type: "Proj" }) {
				yield* Do.bind("base", () => Frame.eval(term)).chain(({ base }) => Frame.of("value", NF.Constructors.StuckProj(base, label)));
			},
		)
		.with({ type: "Proj" }, function* ({ term, label }) {
			yield* Do.bind("base", () => Frame.eval(term)).chain(({ base }) => projectValue(base, label));
		})
		.with(
			{ type: "Inj" },
			() => noReduceEliminations,
			function* ({ term, label, value: valueTerm }: EB.Term & { type: "Inj" }) {
				yield* Do.bind("base", () => Frame.eval(term))
					.bind("injected", () => Frame.eval(valueTerm))
					.chain(({ base, injected }) => Frame.of("value", NF.Constructors.StuckInj(base, label, injected)));
			},
		)
		.with({ type: "Inj" }, function* ({ term, label, value: valueTerm }) {
			yield* Do.bind("base", () => Frame.eval(term))
				.bind("injected", () => Frame.eval(valueTerm))
				.chain(({ base, injected }) => injectValue(base, label, injected));
		})
		.with({ type: "Modal" }, function* ({ term, modalities }) {
			// Evaluate term and liquid, then wrap in Modal
			yield* Frame.cont(2, function* ([nf, liquid]) {
				yield* match(nf)
					.with(NF.Patterns.Modal, function* ({ modalities: innerModalities, value }) {
						yield* Frame.cont("modality", 1, function* ([combined]) {
							yield* Frame.of(NF.Constructors.Modal(value, combined));
						});

						yield* schedule.combine(innerModalities, { quantity: modalities.quantity, liquid });
					})
					.otherwise(function* (v) {
						yield* Frame.of(NF.Constructors.Modal(v, { quantity: modalities.quantity, liquid }));
					});
			});
			yield* Frame.eval(modalities.liquid);
			yield* Frame.eval(term);
		})
		.with({ type: "Block" }, function* ({ statements, return: ret }) {
			// Process statements to extend context, then evaluate return
			yield* processStatementsAndPush(statements, ret);
		})
		.with({ type: "Reset" }, function* ({ term }) {
			// Reset establishes a delimiter for continuation capture.
			yield* Stack.delimit();
			yield* Frame.eval(term);
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
			yield* Frame.cont(1, function* ([h]) {
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
				yield* schedule.reduce(h, kVal, "Explicit");
			});
			// Evaluate the body-lambda; the above continuation receives it.
			yield* Frame.eval(body);
		})
		.with({ type: "Bubble" }, function* ({ meta, shift }) {
			if (yield* Stack.delimited()) {
				yield* Frame.eval(shift);
				return;
			}

			yield* Frame.of(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Meta", val: meta, lvl: 0 })));
		})
		.with({ type: "Ann" }, function* ({ term }) {
			yield* Frame.eval(term);
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
		yield* Frame.eval(returnTerm);
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
				Do.bind("val", () => Frame.eval(value)).chain(function* ({ val }) {
					entry.nf = val;
					yield* processStatementsAndPush(rest, returnTerm);
				}),
			);
		})
		.with({ type: "Expression" }, function* ({ value }) {
			/* The value is discarded; only its effect on the machine matters. */
			yield* Do.bind("discarded", () => Frame.eval(value)).chain(() => processStatementsAndPush(rest, returnTerm));
		})
		.with({ type: "Using" }, function* ({ value, annotation }) {
			// no δ-reduction: we don't want to inline the value, just evaluate it and add it to implicits
			yield* Do.bind("nfValue", () => Mode.local(m => ({ ...m, noInlineBindings: true }), Frame.eval(value))).chain(({ nfValue }) => {
				const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([nfValue, annotation]));

				return M.reader.local(_ => updated, processStatementsAndPush(rest, returnTerm));
			});
		})
		.exhaustive();
}

/**
 * Schedule the evaluation of a row, built up from right to left.
 */
/** Rows complete right-to-left, so a leaf answers through an arity-0 continuation to keep result order. */
function* deferred(value: NF.Value): Evaluation<void> {
	yield* Frame.cont(0, function* () {
		yield* Frame.of(value);
	});
}

function* evalRowPush(row: EB.Row): Evaluation<void> {
	yield* match(row)
		.with({ type: "empty" }, r => deferred(NF.Constructors.Row(r)))
		.with({ type: "extension" }, function* ({ label, value: term, row: restRow }) {
			// Evaluate value and rest, then construct extension
			yield* Do.bind("value", () => Frame.eval(term))
				.bind("rest", () => evalRowPush(restRow))
				.chain(function* ({ value, rest }) {
					if (rest.type !== "Row") {
						throw new Error("Expected Row value in row evaluation");
					}

					yield* Frame.of("value", NF.Constructors.Row(NF.Constructors.Extension(label, value, rest.row)));
				});
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
							/* Deferred like every other leaf here: a row completes right to left, so nothing may answer inline. */
							yield* Frame.cont(0, function* () {
								yield* Frame.cont("quotation", 1, function* ([quoted]) {
									yield* Frame.eval(quoted);
								});

								yield* Quoting.quote(ctx.env.length, NF.Constructors.Row({ type: "variable", variable }));
							});
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

export type Project = { tag: "found"; value: NF.Value } | { tag: "blocked" } | { tag: "missing" } | { tag: "not-applicable" };

const project = function* (base: NF.Value, label: string): Evaluation<void> {
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

	/* A sigma label stands for the value bound at that field; observe through it, not at it. */
	yield* Do.bind("view", "known", () => schedule.view(current)).chain(({ known }) =>
		Frame.of(
			"projection",
			match(known)
				.with({ kind: "Symbolic" }, (): Project => ({ tag: "blocked" }))
				.with({ kind: "Blocked" }, (): Project => ({ tag: "blocked" }))
				.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => lookup(value.row))
				.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) => lookup(value.arg.row))
				.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) => lookup(value.arg.row))
				.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) => lookup(value.arg.row))
				.otherwise((): Project => ({ tag: "not-applicable" })),
		),
	);
};

const projectValue = function* (base: NF.Value, label: string): Evaluation<void> {
	yield* Do.bind("projection", "found", () => project(base, label)).chain(({ found }) =>
		Frame.of(
			"value",
			match(found)
				.with({ tag: "found" }, ({ value }) => value)
				.with({ tag: "missing" }, (): NF.Value => {
					throw new Error(`Projection: label ${label} not found`);
				})
				.otherwise(() => NF.Constructors.StuckProj(base, label)),
		),
	);
};

const inject = function* (base: NF.Value, label: string, injected: NF.Value): Evaluation<void> {
	const set = (row: NF.Row): NF.Row =>
		match(row)
			.with({ type: "empty" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "variable" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "extension" }, ({ label: current, value, row }) =>
				current === label ? NF.Constructors.Extension(label, injected, row) : NF.Constructors.Extension(current, value, set(row)),
			)
			.exhaustive();

	yield* Do.bind("view", "known", () => schedule.view(base)).chain(({ known }) =>
		Frame.of(
			"injection",
			match(known)
				.with({ kind: "Sealed", value: NF.Patterns.Row }, ({ value }) => NF.Constructors.Row(set(value.row)))
				.with({ kind: "Sealed", value: NF.Patterns.Struct }, ({ value }) =>
					NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit),
				)
				.with({ kind: "Sealed", value: NF.Patterns.Schema }, ({ value }) =>
					NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit),
				)
				.with({ kind: "Sealed", value: NF.Patterns.Variant }, ({ value }) =>
					NF.Constructors.App(value.func, NF.Constructors.Row(set(value.arg.row)), value.icit),
				)
				.otherwise(() => undefined),
		),
	);
};

const injectValue = function* (base: NF.Value, label: string, injected: NF.Value): Evaluation<void> {
	yield* Do.bind("injection", "result", () => inject(base, label, injected)).chain(({ result }) =>
		Frame.of("value", result ?? NF.Constructors.StuckInj(base, label, injected)),
	);
};

/**
 * The machine's operations, in the only form the evaluation path may use: they schedule
 * their contractum and answer through the result stack. A value-returning twin would
 * re-enter `evaluate`, making host depth track the program's recursion depth rather than
 * the machine's frame count — the trampoline only bounds work that is scheduled.
 */
export const schedule = {
	/** Applies a function value to an argument, deferring the body rather than driving it. */
	*reduce(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<void> {
		yield* match(nff)
			.with({ type: "Neutral", kind: "Sealed" }, function* ({ value }) {
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.App(value, nfa, icit)));
			})
			.with({ type: "Neutral", kind: "Symbolic" }, function* () {
				yield* Frame.of(NF.Constructors.Neutral("Blocked", NF.Constructors.App(nff, nfa, icit)));
			})
			.with({ type: "Neutral", kind: "Blocked" }, function* ({ value }) {
				yield* Frame.of(NF.Constructors.Neutral("Blocked", NF.Constructors.App(value, nfa, icit)));
			})
			.with({ type: "Modal" }, function* ({ value }) {
				console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
				yield* schedule.reduce(value, nfa, icit);
			})
			.with({ type: "Abs", binder: { type: "Mu" } }, function* () {
				// Do not unfold mu during normalization - defer to unification
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
			})
			.with({ type: "Abs" }, ({ closure, binder }) => schedule.apply(binder, closure, nfa))
			.with({ type: "Lit", value: { type: "Atom" } }, function* ({ value }) {
				yield* Frame.of(NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit));
			})
			.with({ type: "Var", variable: { type: "Meta" } }, function* () {
				const symbolic = NF.Constructors.Neutral("Symbolic", nff);
				yield* Frame.of(NF.Constructors.Neutral("Blocked", NF.Constructors.App(symbolic, nfa, icit)));
			})
			.with({ type: "Var", variable: { type: "Foreign" } }, function* () {
				yield* Frame.of(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
			})
			/*
			 * An over-applied constructor spine: reduce the inner application, then grow the
			 * spine by one. Re-dispatching the result instead would not terminate — an atom
			 * head reduces to the very node it came from.
			 */
			.with({ type: "App" }, function* ({ func, arg, icit: argIcit }) {
				yield* Frame.cont(1, function* ([intermediate]) {
					yield* Frame.of(NF.Constructors.App(intermediate, nfa, icit));
				});
				yield* schedule.reduce(func, arg, argIcit);
			})
			.with({ type: "External" }, function* ({ name, args, arity, compute }) {
				if (arity === 0) {
					yield* Frame.of(compute());
					return;
				}

				const accumulated = [...args, nfa];

				if (accumulated.length < arity) {
					yield* Frame.of(NF.Constructors.External(name, arity, compute, accumulated));
					return;
				}

				if (accumulated.some(blocksExternal)) {
					yield* Frame.of(NF.Constructors.Neutral("Blocked", NF.Constructors.External(name, arity, compute, accumulated)));
					return;
				}

				yield* Frame.of(compute(...accumulated.map(ignoraModal)));
			})
			.otherwise(function* () {
				throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
			});
	},

	/** Consumes a closure with an argument: the body's scope, or the primop's answer, or the continuation's replay. */
	*apply(binder: EB.Binder, closure: NF.Closure, value: NF.Value): Evaluation<void> {
		const extended = (cls: Exclude<NF.Closure, { type: "Continuation" }>) => {
			if (binder.type !== "Sigma") {
				return EB.extend(cls.ctx, binder, value);
			}
			assert(value.type === "Row", "Sigma binder should be applied to a Row");
			return EB.extendSigma(cls.ctx, value.row);
		};

		yield* match(closure)
			.with({ type: "Closure" }, cls => M.reader.local(_ => extended(cls), Frame.eval(cls.term)))
			.with({ type: "PrimOp" }, function* (primop) {
				const args = extended(primop)
					.env.slice(0, primop.arity)
					.map(({ nf }) => nf);
				yield* Frame.of(primop.compute(...args));
			})
			.with({ type: "Continuation" }, function* (cont) {
				// Replay the captured continuation with the argument at the shift point.
				yield* Stack.resume({ frames: cont.frames, results: cont.results, env: cont.ctx }, value);
			})
			.exhaustive();
	},

	/** Runs the alternative that fires; a blocked match answers with the suspension so `resume` can retry it. */
	*matching(nf: NF.Value, alts: EB.Alternative[], suspension: NF.Value): Evaluation<void> {
		if (alts.length === 0) {
			throw new Error("Match: No alternative matched");
		}

		const ctx = yield* M.reader.ask();
		const [alt, ...rest] = alts;

		yield* Do.bind("observation", "verdict", () => schedule.meet(alt.pattern, nf)).chain(({ verdict }) =>
			match(verdict)
				.with({ tag: "matched" }, function* ({ bindings }) {
					const extendedCtx = bindings.reduce((_ctx, { binder, nf: bound }) => EB.extend(_ctx, binder, bound), ctx);
					yield* M.reader.local(_ => extendedCtx, Frame.eval(alt.term));
				})
				.with({ tag: "blocked" }, function* () {
					yield* Frame.of(suspension);
				})
				.with({ tag: "mismatch" }, function* () {
					yield* schedule.matching(nf, rest, suspension);
				})
				.exhaustive(),
		);
	},

	/**
	 * Observes a pattern against a value. Forcing the scrutinee is the only machine work, so it is
	 * scheduled and the dispatch it feeds becomes the frame that receives it; what the recursive
	 * form returned, this hands to `k`.
	 */
	*meet(pattern: EB.Pattern, nf: NF.Value): Evaluation<void> {
		const immediate = match(pattern)
			.with({ type: "Wildcard" }, () => matched([]))
			.with({ type: "Binder" }, ({ value }) => {
				const binder: EB.Binder = { type: "Lambda", variable: value };
				return matched([{ binder, nf }]);
			})
			.otherwise(() => undefined);

		if (immediate) {
			yield* Frame.of("observation", immediate);
			return;
		}

		yield* Frame.cont("view", 1, function* ([known]) {
			if (known.kind !== "Sealed") {
				yield* Frame.of("observation", blocked());
				return;
			}

			yield* match([known.value, pattern])
				.with([{ type: "Neutral" }, P._], () => Frame.of("observation", blocked()))
				.with([{ type: "Lit" }, { type: "Lit" }], ([value, p]) => Frame.of("observation", _.isEqual(value.value, p.value) ? matched([]) : mismatch()))
				.with(
					[NF.Patterns.Array, { type: "List" }],
					([value, p]) => value.arg.row.type === "empty" && p.patterns.length === 0 && !p.rest,
					() => Frame.of("observation", matched([])),
				)
				.with(
					[NF.Patterns.Array, { type: "List" }],
					([, p]) => p.patterns.length === 0 && !p.rest,
					() => Frame.of("observation", mismatch()),
				)
				.with([NF.Patterns.Array, { type: "List" }], ([value, p]) => {
					const zip = function* (patterns: EB.Pattern[], row: NF.Row): Evaluation<void> {
						if (patterns.length === 0) {
							if (!p.rest) {
								yield* Frame.of("observation", matched([]));
								return;
							}

							const binder: EB.Binder = { type: "Lambda", variable: p.rest };
							yield* Frame.of("observation", matched([{ binder, nf: NF.Constructors.Array(row) }]));
							return;
						}

						if (row.type !== "extension") {
							yield* Frame.of("observation", mismatch());
							return;
						}

						const [head, ...tail] = patterns;
						const remaining = row;

						yield* Do.bind("observation", "current", () => schedule.meet(head, remaining.value))
							.bind("observation", "rest", () => zip(tail, remaining.row))
							.chain(({ current, rest }) => Frame.of("observation", combineMeet(current, rest)));
					};

					return zip(p.patterns, value.arg.row);
				})
				.with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], ([{ arg }, p]) => meetAll(p.row, arg.row))
				.with([NF.Patterns.Row, { type: "Row" }], ([value, p]) => meetAll(p.row, value.row))
				.with([NF.Patterns.Tagged, { type: "Variant", row: { type: "extension" } }], function* ([{ arg }, p]) {
					const value = NF.TaggedValue.extract(arg.row);
					if (!value) {
						yield* Frame.of("observation", mismatch());
						return;
					}

					const rewritten = R.rewrite(p.row, value.label);
					if (E.isLeft(rewritten) || rewritten.right.type !== "extension") {
						yield* Frame.of("observation", mismatch());
						return;
					}

					const arm = rewritten.right;

					yield* Do.bind("observation", "payload", () => schedule.meet(arm.value, value.payload))
						.bind("observation", "rest", () => meetAll(arm.row, R.Constructors.Empty()))
						.chain(({ payload, rest }) => Frame.of("observation", combineMeet(payload, rest)));
				})
				.with([NF.Patterns.Variant, { type: "Variant" }], ([{ arg }, p]) => meetAll(p.row, arg.row))
				.with([NF.Patterns.HashMap, { type: "List" }], () => {
					console.warn("List pattern matching not yet implemented");
					return Frame.of("observation", matched([]));
				})
				.with([NF.Patterns.Atom, { type: "Var" }], ([{ value }, p]) => Frame.of("observation", value.value === p.value ? matched([]) : mismatch()))
				.otherwise(() => Frame.of("observation", mismatch()));
		});

		yield* schedule.view(nf);
	},

	/**
	 * Forces to the first shape a consumer can inspect. Continuing at a solution or a contractum
	 * is handed back to the driver rather than delegated to, so a chain of residuals is a run of
	 * frames and a label or meta that resolves back to itself spends the machine's fuel.
	 */
	*force(value: NF.Value): Evaluation<void> {
		/* A meta reached bare or under a Symbolic wrapper resolves the same way; only the route to it differs. */
		const solved = function* (meta: Extract<NF.Variable, { type: "Meta" }>): Evaluation<void> {
			const solution = Metas.solution(yield* Metas.registry.get(), meta.val);

			yield* solution ? Frame.cont(0, () => schedule.force(solution)) : Frame.of(value);
		};

		/* Likewise a blocked elimination, wrapped or bare: retry it, and keep forcing while it progresses. */
		const step = (subject: NF.Value): Evaluation<void> =>
			Do.bind("next", () => schedule.resume(subject)).chain(({ next }) => (next === subject ? Frame.of(value) : schedule.force(next)));

		yield* match(value)
			.with({ type: "Neutral", kind: "Sealed" }, () => Frame.of(value))
			.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, function* ({ value: label }) {
				const ctx = yield* M.reader.ask();

				const next = match(ctx.sigma[label.variable.name])
					.with({ value: { type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label } }, ({ value: placeholder }) =>
						placeholder.value.variable.name === label.variable.name ? value : placeholder,
					)
					.with({ value: P.select() }, resolved => resolved)
					.otherwise(() => value);

				yield* next === value ? Frame.of(value) : Frame.cont(0, () => schedule.force(next));
			})
			.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Flex }, ({ value: flex }) => solved(flex.variable))
			.with({ type: "Neutral", kind: "Symbolic" }, () => Frame.of(value))
			.with({ type: "Neutral", kind: "Blocked" }, ({ value: blocked }) => step(blocked))
			.with(NF.Patterns.Flex, ({ variable }) => solved(variable))
			.otherwise(() => step(value));
	},

	/**
	 * Merges two modal annotations. Re-runs both liquid predicates against a shared rigid and
	 * conjoins them, which needs application and quotation, so it belongs to the machine rather
	 * than to verification — it is only ever reached from the Modal arm, mid-drive.
	 */
	*combine(a: Modal.Annotations<NF.Value>, b: Modal.Annotations<NF.Value>): Evaluation<void> {
		assert(a.liquid.type === "Abs" && a.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");
		assert(b.liquid.type === "Abs" && b.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");

		const left = a.liquid;
		const right = b.liquid;
		const ctx = yield* M.reader.ask();
		const name = `${left.binder.variable}_and_${right.binder.variable}`;
		const lvl = ctx.env.length;

		yield* Do.bind("anf", () => schedule.apply(left.binder, left.closure, NF.Constructors.Rigid(lvl)))
			.bind("bnf", () => schedule.apply(right.binder, right.closure, NF.Constructors.Rigid(lvl)))
			.bind("quotation", "term", ({ anf, bnf }) => Quoting.quote(lvl + 1, DSL.Binop.and(anf, bnf)))
			.chain(({ term }) =>
				Frame.of("modality", {
					quantity: Q.SR.mul(a.quantity, b.quantity),
					liquid: NF.Constructors.Lambda(name, "Explicit", NF.Constructors.Closure(ctx, term), left.binder.annotation),
				}),
			);
	},

	/**
	 * Forces, then reports which neutral kind the result presents. `force`, `view` and `resume`
	 * are the three requests a consumer makes of a value's neutral status, and this is the one
	 * that answers with a classification rather than a value.
	 */
	*view(value: NF.Value): Evaluation<void> {
		yield* Do.bind("forced", () => schedule.force(value)).chain(({ forced }) =>
			Frame.of(
				"view",
				match<NF.Value, View>(forced)
					.with({ type: "Neutral" }, ({ kind, value }) => ({ kind, value }))
					.otherwise(value => ({ kind: "Sealed", value })),
			),
		);
	},

	/**
	 * Retries one suspended elimination. Answering with the value it was handed means nothing
	 * fired, which is the only signal needed: every arm forces what it inspects first, so a
	 * suspension that survives a retry is stable.
	 */
	*resume(value: NF.Value): Evaluation<void> {
		yield* match(value)
			.with(NF.Patterns.Proj, function* ({ base, label }) {
				yield* Frame.cont("projection", 1, function* ([found]) {
					yield* Frame.of(
						match(found)
							.with({ tag: "found" }, ({ value: projected }) => projected)
							.with({ tag: "missing" }, (): NF.Value => {
								throw new Error(`Projection: label ${label} not found`);
							})
							.otherwise(() => value),
					);
				});

				yield* project(base, label);
			})
			.with(NF.Patterns.Match, function* ({ closure, scrutinee }) {
				assert(closure.type === "Closure", "Blocked match should retain a term closure");
				assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

				yield* M.reader.local(_ => closure.ctx, schedule.matching(scrutinee, closure.term.alternatives, value));
			})
			.with(NF.Patterns.Inj, function* ({ base, label, injected }) {
				yield* Frame.cont("injection", 1, function* ([result]) {
					yield* Frame.of(result ?? value);
				});

				yield* inject(base, label, injected);
			})
			.with(NF.Patterns.App, ({ func, arg, icit: appIcit }) =>
				Do.bind("forced", () => schedule.force(func)).chain(({ forced }) => (forced === func ? Frame.of(value) : schedule.reduce(forced, arg, appIcit))),
			)
			.with({ type: "External" }, function* (ext) {
				if (ext.args.length < ext.arity) {
					yield* Frame.of(value);
					return;
				}

				yield* Frame.cont(ext.args.length, function* (forced) {
					const changed = forced.some((arg, index) => arg !== ext.args[index]);

					if (forced.some(blocksExternal)) {
						yield* Frame.of(changed ? NF.Constructors.Neutral("Blocked", NF.Constructors.External(ext.name, ext.arity, ext.compute, forced)) : value);
						return;
					}

					yield* Frame.of(ext.compute(...forced.map(ignoraModal)));
				});

				/* Back to front: the driver pops last-in-first, so this answers in argument order. */
				yield* Eff.traverse([...ext.args].reverse(), arg => Frame.cont(0, () => schedule.force(arg)));
			})
			.otherwise(() => Frame.of(value));
	},
};

/** The driven form of `schedule.reduce`, for consumers outside the evaluation path. */
export function* reduce(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.reduce(nff, nfa, icit),
		MAX_STEPS,
		() => `Reduction exceeded maximum steps (${MAX_STEPS}). Possible infinite loop applying: ${shown(ctx, () => display(nff))}`,
	);
}

/**
 * The driven form of `schedule.apply`, for consumers outside the evaluation path — quoting,
 * arity, unification, generalization, verification. Converting those to schedule is the
 * remaining step; it deletes this wrapper rather than changing what it wraps.
 */
export function* apply(binder: EB.Binder, closure: NF.Closure, value: NF.Value): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.apply(binder, closure, value),
		MAX_STEPS,
		() => `Application exceeded maximum steps (${MAX_STEPS}). Possible infinite loop applying ${binder.variable} to: ${shown(ctx, () => display(value))}`,
	);
}

export type View = { kind: NF.Neutral; value: NF.Value };

/** The driven form of `schedule.resume`; getting the same value back means nothing fired. */
export function* resume(value: NF.Value): Evaluation<Option<NF.Value>> {
	const ctx = yield* M.reader.ask();
	const next = yield* drive(
		schedule.resume(value),
		MAX_STEPS,
		() => `Resumption exceeded maximum steps (${MAX_STEPS}). Possible infinite loop resuming: ${shown(ctx, () => display(value))}`,
	);

	return next === value ? O.none : O.some(next);
}

/** The driven form of `schedule.force`, for consumers outside the evaluation path. */
export function* force(value: NF.Value): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.force(value),
		MAX_STEPS,
		() => `Forcing exceeded maximum steps (${MAX_STEPS}). Possible cycle in a label or meta solution for: ${shown(ctx, () => display(value))}`,
	);
}

export function* view(value: NF.Value): Evaluation<View> {
	const ctx = yield* M.reader.ask();

	return yield* drive<View>(
		schedule.view(value),
		MAX_STEPS,
		() => `Observation exceeded maximum steps (${MAX_STEPS}). Possible cycle in a label or meta solution for: ${shown(ctx, () => display(value))}`,
	);
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

const meetAll = function* (pats: R.Row<EB.Pattern, string>, vals: NF.Row): Evaluation<void> {
	yield* match([pats, vals])
		.with([{ type: "empty" }, P._], () => Frame.of("observation", matched([])))
		.with([{ type: "variable" }, P._], ([r, tail]) => {
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return Frame.of("observation", matched([{ binder, nf: NF.Constructors.Row(tail) }]));
		})
		.with([{ type: "extension" }, { type: "empty" }], [{ type: "extension" }, { type: "variable" }], () => Frame.of("observation", mismatch()))
		.with([{ type: "extension" }, { type: "extension" }], function* ([r1, r2]) {
			const rewritten = R.rewrite(r2, r1.label);
			if (E.isLeft(rewritten)) {
				yield* Frame.of("observation", mismatch());
				return;
			}

			if (rewritten.right.type !== "extension") {
				throw new Error("Rewriting a row extension should result in another row extension");
			}

			const tail = rewritten.right;

			yield* Do.bind("observation", "current", () => schedule.meet(r1.value, tail.value))
				.bind("observation", "rest", () => meetAll(r1.row, tail.row))
				.chain(({ current, rest }) => Frame.of("observation", combineMeet(current, rest)));
		})
		.exhaustive();
};

/**
 * The driven form: runs the observation on the machine and answers with the verdict it reached.
 * A verdict is not an `NF.Value`, so it cannot come back over the result stack; the terminal
 * continuation hands it out instead.
 */
export function* meet(pattern: EB.Pattern, nf: NF.Value): Evaluation<Meet> {
	return yield* drive<Meet>(schedule.meet(pattern, nf), MAX_STEPS, () => `Pattern observation exceeded maximum steps (${MAX_STEPS}).`);
}
