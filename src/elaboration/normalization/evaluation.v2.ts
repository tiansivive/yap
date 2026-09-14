/* eslint-disable no-restricted-syntax, no-restricted-properties, @typescript-eslint/consistent-type-assertions --
 * NbE: the machine (./machine) instantiated at a scope of environment and mode, terms as control,
 * and values as results. The driver loop below is the intentional CEK core, and it restores the row
 * the machine erased when it stored a continuation.
 */
import { match, P } from "ts-pattern";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "./syntax/term";
import * as DSL from "./syntax/dsl";
import { display } from "./syntax/pretty";

import * as Stack from "./machine/actions";
import type { Blame, Mark } from "./machine/frames";
import { Do, Mode, group, result, scope, step, type Evaluation, type Machine, type Scope } from "./effects";
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
export function* evaluate(term: EB.Term): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.eval(term),
		steps => `Evaluation exceeded maximum steps (${steps}). Possible infinite loop in: ${shown(ctx, () => EB.Display.Term(term))}`,
	);
}

/**
 * A marked drive: schedule the work, run it to exhaustion, take its single result.
 * Reading a value out of the machine costs a level of host recursion, so this is a
 * boundary operation — the evaluation path schedules instead, and `schedule` is the
 * canonical form every operation here is written in.
 */
export function* drive<A>(work: Evaluation<Machine<A>>, blame: Blame): Evaluation<A> {
	const mark = yield* Stack.begin(blame);
	yield* work;
	yield* trampoline(mark);

	return yield* Stack.finish<A>(mark);
}

/** Runs a drive's frames to exhaustion. Fuel is the machine's, so the cap is enforced where it is counted. */
function* trampoline(mark: Mark): Evaluation<void> {
	while (true) {
		const frame = yield* Stack.next<Scope, EB.Term>(mark);

		if (!frame) {
			break;
		}

		/* The driver re-binds both readers per step: the frame's scope is the single authority. */
		yield* match(frame)
			.with({ type: "Control" }, ({ scope: { env, mode }, control }) =>
				M.reader.local(
					_ => env,
					Mode.local(_ => mode, evaluateTerm(control)),
				),
			)
			.with({ type: "Cont" }, ({ scope: { env, mode }, k, operands }) =>
				M.reader.local(
					_ => env,
					Mode.local(_ => mode, k(operands) as Evaluation<unknown>),
				),
			)
			.exhaustive();
	}
}

function* evaluateTerm(term: EB.Term): Evaluation<Machine<NF.Value>> {
	const ctx = yield* M.reader.ask();
	const { noInlineBindings, noReduceEliminations } = yield* Mode.ask();

	return yield* match(term)
		.with({ type: "Lit" }, function* ({ value }) {
			return yield* result(NF.Constructors.Lit(value));
		})
		.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
			const sig = ctx.sigma[variable.name];
			if (sig) {
				return yield* result(sig.value);
			}

			const rec = ctx.record[variable.name];
			if (rec?.value) {
				return yield* result(rec.value);
			}
			if (rec?.term) {
				return yield* schedule.eval(rec.term);
			}

			throw new Error("Unbound label: " + variable.name);
		})
		.with(
			{ type: "Var", variable: { type: "Free" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
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
			return yield* Do.let(
				"nf",
				M.reader.local(_ => xtended, schedule.eval(val[0])),
			).in(function* ({ nf }) {
				entry.nf = nf;

				return yield* result(nf);
			});
		})
		.with({ type: "Var", variable: { type: "Meta" } }, function* ({ variable }) {
			const registry = yield* Metas.registry.get();
			const solution = Metas.solution(registry, variable.val);

			if (!solution) {
				return yield* result(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var(variable)));
			}

			// Force re-evaluation of the solution
			return yield* Do.let("quoted", Quoting.quote(ctx.env.length, solution)).in(({ quoted }) => schedule.eval(quoted));
		})
		.with(
			{ type: "Var", variable: { type: "Bound" } },
			_ => noInlineBindings,
			function* ({ variable }) {
				const lvl = ctx.env.length - 1 - variable.index;
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.Var({ type: "Bound", lvl })));
			},
		)
		.with({ type: "Var", variable: { type: "Bound" } }, function* ({ variable }) {
			const entry = ctx.env[variable.index];
			return yield* match(entry.type[0])
				.with({ type: "Mu" }, function* () {
					return yield* result(NF.Constructors.Neutral("Sealed", entry.nf));
				})
				.otherwise(function* () {
					return yield* result(entry.nf);
				});
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* ({ variable }) {
			const val = ctx.ffi[variable.name];

			if (!val) {
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.Var(variable)));
			}

			return yield* match(val)
				.with({ arity: 0 }, ffi => result(ffi.compute()))
				.otherwise(ffi => result(NF.Constructors.External(variable.name, ffi.arity, ffi.compute, [])));
		})
		.with({ type: "Abs", binding: { type: "Lambda" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Lambda
			return yield* Do.let("ann", schedule.eval(binding.annotation)).in(({ ann }) =>
				result(NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann)),
			);
		})
		.with({ type: "Abs", binding: { type: "Pi" } }, function* ({ body, binding }) {
			// Evaluate annotation, then construct Pi
			return yield* Do.let("ann", schedule.eval(binding.annotation)).in(({ ann }) =>
				result(NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body))),
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
			return yield* Do.let(
				"ann",
				M.reader.local(_ => xtended, evalRowPush(annotation)),
			).in(({ ann }) => result(NF.Constructors.Sigma(binding.variable, ann, NF.Constructors.Closure(ctx, body))));
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, function* (mu) {
			// Evaluate annotation, then construct Mu
			return yield* Do.let("ann", schedule.eval(mu.binding.annotation)).in(({ ann }) =>
				result(NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body))),
			);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			// Evaluate func and arg, then reduce
			return yield* Do.let("funcVal", schedule.eval(func))
				.let("argVal", schedule.eval(arg))
				.in(({ funcVal, argVal }) => schedule.reduce(funcVal, argVal, icit));
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
			return yield* M.reader.local(_ => xtended, evalRowPush(row));
		})
		.with(
			{ type: "Match" },
			() => noReduceEliminations,
			function* (v: EB.Term & { type: "Match" }) {
				return yield* Do.let("scrutinee", schedule.eval(v.scrutinee)).in(({ scrutinee }) =>
					result(NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee)),
				);
			},
		)
		.with({ type: "Match" }, function* (v) {
			return yield* Do.let("scrutinee", schedule.eval(v.scrutinee)).in(({ scrutinee }) =>
				schedule.matching(scrutinee, v.alternatives, NF.Constructors.StuckMatch(NF.Constructors.Closure(ctx, v), scrutinee)),
			);
		})
		.with(
			{ type: "Proj" },
			() => noReduceEliminations,
			function* ({ term, label }: EB.Term & { type: "Proj" }) {
				return yield* Do.let("base", schedule.eval(term)).in(({ base }) => result(NF.Constructors.StuckProj(base, label)));
			},
		)
		.with({ type: "Proj" }, function* ({ term, label }) {
			return yield* Do.let("base", schedule.eval(term)).in(({ base }) => projectValue(base, label));
		})
		.with(
			{ type: "Inj" },
			() => noReduceEliminations,
			function* ({ term, label, value: valueTerm }: EB.Term & { type: "Inj" }) {
				return yield* Do.let("base", schedule.eval(term))
					.let("injected", schedule.eval(valueTerm))
					.in(({ base, injected }) => result(NF.Constructors.StuckInj(base, label, injected)));
			},
		)
		.with({ type: "Inj" }, function* ({ term, label, value: valueTerm }) {
			return yield* Do.let("base", schedule.eval(term))
				.let("injected", schedule.eval(valueTerm))
				.in(({ base, injected }) => injectValue(base, label, injected));
		})
		.with({ type: "Modal" }, function* ({ term, modalities }) {
			// Evaluate term and liquid, then wrap in Modal
			return yield* Do.let("nf", schedule.eval(term))
				.let("liquid", schedule.eval(modalities.liquid))
				.in(function* ({ nf, liquid }) {
					return yield* match(nf)
						.with(NF.Patterns.Modal, function* ({ modalities: innerModalities, value }) {
							return yield* Do.let("combined", schedule.combine(innerModalities, { quantity: modalities.quantity, liquid })).in(({ combined }) =>
								result(NF.Constructors.Modal(value, combined)),
							);
						})
						.otherwise(function* (v) {
							return yield* result(NF.Constructors.Modal(v, { quantity: modalities.quantity, liquid }));
						});
				});
		})
		.with({ type: "Block" }, function* ({ statements, return: ret }) {
			// Process statements to extend context, then evaluate return
			return yield* processStatementsAndPush(statements, ret);
		})
		.with({ type: "Reset" }, function* ({ term }) {
			// Reset establishes a delimiter for continuation capture.
			yield* Stack.delimit(yield* scope());
			return yield* schedule.eval(term);
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
			return yield* Do.let("h", schedule.eval(body)).in(function* ({ h }) {
				const captured = yield* Stack.capture<Scope, EB.Term>();
				if (!captured) {
					throw new Error("Shift without enclosing reset");
				}

				// A continuation closure that, when applied to a value v, replays
				// the captured continuation as if resumed at the shift point.
				const continuation: NF.Closure = {
					type: "Continuation",
					frames: captured.frames,
					ctx: captured.scope.env,
					term: EB.Constructors.Lit(Lit.unit()), // dummy term
				};

				const kVal = NF.Constructors.Lambda("kArg", "Explicit", continuation, NF.Any);

				// Apply the desugared handler `h : (A -> R) -> R` to `kVal`.
				return yield* schedule.reduce(h, kVal, "Explicit");
			});
		})
		.with({ type: "Bubble" }, function* ({ meta, shift }) {
			if (yield* Stack.find<Scope, EB.Term>(frame => frame.type === "Delimiter")) {
				return yield* schedule.eval(shift);
			}

			return yield* result(NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Meta", val: meta, lvl: 0 })));
		})
		.with({ type: "Ann" }, function* ({ term }) {
			return yield* schedule.eval(term);
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
function* processStatementsAndPush(stmts: EB.Statement[], returnTerm: EB.Term): Evaluation<Machine<NF.Value>> {
	if (stmts.length === 0) {
		// No more statements, evaluate the return term
		return yield* schedule.eval(returnTerm);
	}

	const ctx = yield* M.reader.ask();
	const [current, ...rest] = stmts;

	return yield* match(current)
		.with({ type: "Let" }, function* ({ variable, annotation, value }) {
			const entry: EB.Context["env"][number] = {
				nf: NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length }),
				type: [{ type: "Let", variable }, "source", annotation],
				name: { type: "Let", variable },
			};
			const extended = { ...ctx, env: [entry, ...ctx.env] };

			return yield* M.reader.local(
				_ => extended,
				Do.let("val", schedule.eval(value)).in(function* ({ val }) {
					entry.nf = val;
					return yield* processStatementsAndPush(rest, returnTerm);
				}),
			);
		})
		.with({ type: "Expression" }, function* ({ value }) {
			/* The value is discarded; only its effect on the machine matters. */
			return yield* Do.let("discarded", schedule.eval(value)).in(() => processStatementsAndPush(rest, returnTerm));
		})
		.with({ type: "Using" }, function* ({ value, annotation }) {
			// no δ-reduction: we don't want to inline the value, just evaluate it and add it to implicits
			return yield* Do.let(
				"nfValue",
				Mode.local(m => ({ ...m, noInlineBindings: true }), schedule.eval(value)),
			).in(({ nfValue }) => {
				const updated = update(ctx, "implicits", A.append<EB.Context["implicits"][0]>([nfValue, annotation]));

				return M.reader.local(_ => updated, processStatementsAndPush(rest, returnTerm));
			});
		})
		.exhaustive();
}

/**
 * Schedule the evaluation of a row, built up from right to left.
 */
/** Rows complete right-to-left, so a leaf goes through an arity-0 continuation to keep result order. */
function* deferred(value: NF.Value): Evaluation<Machine<NF.Value>> {
	return yield* step(result(value));
}

function* evalRowPush(row: EB.Row): Evaluation<Machine<NF.Value>> {
	return yield* match(row)
		.with({ type: "empty" }, r => deferred(NF.Constructors.Row(r)))
		.with({ type: "extension" }, function* ({ label, value: term, row: restRow }) {
			// Evaluate value and rest, then construct extension
			return yield* Do.let("value", schedule.eval(term))
				.let("rest", evalRowPush(restRow))
				.in(function* ({ value, rest }) {
					if (rest.type !== "Row") {
						throw new Error("Expected Row value in row evaluation");
					}

					return yield* result(NF.Constructors.Row(NF.Constructors.Extension(label, value, rest.row)));
				});
		})
		.with({ type: "variable" }, function* (r) {
			return yield* match(r.variable)
				.with({ type: "Meta" }, function* (v) {
					const registry = yield* Metas.registry.get();
					const solved = Metas.solution(registry, v.val);

					if (!solved) {
						return yield* deferred(NF.Constructors.Row({ type: "variable", variable: v }));
					}

					const ctx = yield* M.reader.ask();

					return yield* match(solved)
						.with({ type: "Row" }, deferred)
						/*
						 * A solution naming a variable is a reference, not a result: the slot it
						 * names is where instantiation installs the use site's fresh meta. Quoting
						 * back to syntax and re-evaluating resolves it against the current scope,
						 * exactly as the value path does for a solved meta.
						 */
						.with({ type: "Var" }, function* ({ variable }) {
							/* Deferred like every other leaf here: a row completes right to left, so nothing may produce its result inline. */
							return yield* step(
								Do.let("quoted", Quoting.quote(ctx.env.length, NF.Constructors.Row({ type: "variable", variable }))).in(({ quoted }) => schedule.eval(quoted)),
							);
						})
						.otherwise(nf => {
							throw new Error("Solved meta in row position is not a row or variable: " + shown(ctx, () => display(nf)));
						});
				})
				.with({ type: "Bound" }, function* (v) {
					const ctx = yield* M.reader.ask();

					return yield* match(unwrapNeutral(ctx.env[v.index].nf))
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

const project = function* (base: NF.Value, label: string): Evaluation<Machine<Project>> {
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
	return yield* Do.let("known", schedule.view(current)).in(({ known }) =>
		result(
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

const projectValue = function* (base: NF.Value, label: string): Evaluation<Machine<NF.Value>> {
	return yield* Do.let("found", project(base, label)).in(({ found }) =>
		result(
			match(found)
				.with({ tag: "found" }, ({ value }) => value)
				.with({ tag: "missing" }, (): NF.Value => {
					throw new Error(`Projection: label ${label} not found`);
				})
				.otherwise(() => NF.Constructors.StuckProj(base, label)),
		),
	);
};

const inject = function* (base: NF.Value, label: string, injected: NF.Value): Evaluation<Machine<NF.Value | undefined>> {
	const set = (row: NF.Row): NF.Row =>
		match(row)
			.with({ type: "empty" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "variable" }, (): NF.Row => NF.Constructors.Extension(label, injected, row))
			.with({ type: "extension" }, ({ label: current, value, row }) =>
				current === label ? NF.Constructors.Extension(label, injected, row) : NF.Constructors.Extension(current, value, set(row)),
			)
			.exhaustive();

	return yield* Do.let("known", schedule.view(base)).in(({ known }) =>
		result(
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

const injectValue = function* (base: NF.Value, label: string, injected: NF.Value): Evaluation<Machine<NF.Value>> {
	return yield* Do.let("replaced", inject(base, label, injected)).in(({ replaced }) => result(replaced ?? NF.Constructors.StuckInj(base, label, injected)));
};

/**
 * The machine's operations, in the only form the evaluation path may use: they schedule
 * their contractum and produce a result through the machine. A value-returning twin would
 * re-enter `evaluate`, making host depth track the program's recursion depth rather than
 * the machine's frame count — the trampoline only bounds work that is scheduled.
 */
export const schedule = {
	/** Schedules a term: the driver reads it, and its result is the term's value. */
	*eval(term: EB.Term): Evaluation<Machine<NF.Value>> {
		return yield* Stack.push<NF.Value, Scope, EB.Term>(yield* scope(), term);
	},

	/** Applies a function value to an argument, deferring the body rather than driving it. */
	*reduce(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<Machine<NF.Value>> {
		return yield* match(nff)
			.with({ type: "Neutral", kind: "Sealed" }, function* ({ value }) {
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.App(value, nfa, icit)));
			})
			.with({ type: "Neutral", kind: "Symbolic" }, function* () {
				return yield* result(NF.Constructors.Neutral("Blocked", NF.Constructors.App(nff, nfa, icit)));
			})
			.with({ type: "Neutral", kind: "Blocked" }, function* ({ value }) {
				return yield* result(NF.Constructors.Neutral("Blocked", NF.Constructors.App(value, nfa, icit)));
			})
			.with({ type: "Modal" }, function* ({ value }) {
				console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
				return yield* schedule.reduce(value, nfa, icit);
			})
			.with({ type: "Abs", binder: { type: "Mu" } }, function* () {
				// Do not unfold mu during normalization - defer to unification
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
			})
			.with({ type: "Abs" }, ({ closure, binder }) => schedule.apply(binder, closure, nfa))
			.with({ type: "Lit", value: { type: "Atom" } }, function* ({ value }) {
				return yield* result(NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit));
			})
			.with({ type: "Var", variable: { type: "Meta" } }, function* () {
				const symbolic = NF.Constructors.Neutral("Symbolic", nff);
				return yield* result(NF.Constructors.Neutral("Blocked", NF.Constructors.App(symbolic, nfa, icit)));
			})
			.with({ type: "Var", variable: { type: "Foreign" } }, function* () {
				return yield* result(NF.Constructors.Neutral("Sealed", NF.Constructors.App(nff, nfa, icit)));
			})
			/*
			 * An over-applied constructor spine: reduce the inner application, then grow the
			 * spine by one. Re-dispatching the result instead would not terminate — an atom
			 * head reduces to the very node it came from.
			 */
			.with({ type: "App" }, function* ({ func, arg, icit: argIcit }) {
				return yield* Do.let("intermediate", schedule.reduce(func, arg, argIcit)).in(({ intermediate }) =>
					result(NF.Constructors.App(intermediate, nfa, icit)),
				);
			})
			.with({ type: "External" }, function* ({ name, args, arity, compute }) {
				if (arity === 0) {
					return yield* result(compute());
				}

				const accumulated = [...args, nfa];

				if (accumulated.length < arity) {
					return yield* result(NF.Constructors.External(name, arity, compute, accumulated));
				}

				if (accumulated.some(blocksExternal)) {
					return yield* result(NF.Constructors.Neutral("Blocked", NF.Constructors.External(name, arity, compute, accumulated)));
				}

				return yield* result(compute(...accumulated.map(ignoreModal)));
			})
			.otherwise(function* () {
				throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
			});
	},

	/** Consumes a closure with an argument: the body's scope, or the primop's result, or the continuation's replay. */
	*apply(binder: EB.Binder, closure: NF.Closure, value: NF.Value): Evaluation<Machine<NF.Value>> {
		const extended = (cls: Exclude<NF.Closure, { type: "Continuation" }>) => {
			if (binder.type !== "Sigma") {
				return EB.extend(cls.ctx, binder, value);
			}
			assert(value.type === "Row", "Sigma binder should be applied to a Row");
			return EB.extendSigma(cls.ctx, value.row);
		};

		return yield* match(closure)
			.with({ type: "Closure" }, cls => M.reader.local(_ => extended(cls), schedule.eval(cls.term)))
			.with({ type: "PrimOp" }, function* (primop) {
				const args = extended(primop)
					.env.slice(0, primop.arity)
					.map(({ nf }) => nf);
				return yield* result(primop.compute(...args));
			})
			.with({ type: "Continuation" }, function* (cont) {
				// Replay the captured continuation with the argument at the shift point.
				return yield* Stack.resume<NF.Value, Scope, EB.Term>({ frames: cont.frames, scope: { env: cont.ctx, mode: yield* Mode.ask() } }, value);
			})
			.exhaustive();
	},

	/** Runs the alternative that fires; a blocked match results in the suspension so `resume` can retry it. */
	*matching(nf: NF.Value, alts: EB.Alternative[], suspension: NF.Value): Evaluation<Machine<NF.Value>> {
		if (alts.length === 0) {
			throw new Error("Match: No alternative matched");
		}

		const ctx = yield* M.reader.ask();
		const [alt, ...rest] = alts;

		return yield* Do.let("verdict", schedule.meet(alt.pattern, nf)).in(({ verdict }) =>
			match(verdict)
				.with({ tag: "matched" }, function* ({ bindings }) {
					const extendedCtx = bindings.reduce((_ctx, { binder, nf: bound }) => EB.extend(_ctx, binder, bound), ctx);
					return yield* M.reader.local(_ => extendedCtx, schedule.eval(alt.term));
				})
				.with({ tag: "blocked" }, function* () {
					return yield* result(suspension);
				})
				.with({ tag: "mismatch" }, function* () {
					return yield* schedule.matching(nf, rest, suspension);
				})
				.exhaustive(),
		);
	},

	/**
	 * Observes a pattern against a value. Forcing the scrutinee is the only machine work, so it is
	 * scheduled and the dispatch it feeds becomes the frame that receives it; what the recursive
	 * form returned, this hands to `k`.
	 */
	*meet(pattern: EB.Pattern, nf: NF.Value): Evaluation<Machine<Meet>> {
		const immediate = match(pattern)
			.with({ type: "Wildcard" }, () => matched([]))
			.with({ type: "Binder" }, ({ value }) => {
				const binder: EB.Binder = { type: "Lambda", variable: value };
				return matched([{ binder, nf }]);
			})
			.otherwise(() => undefined);

		if (immediate) {
			return yield* result(immediate);
		}

		return yield* Do.let("known", schedule.view(nf)).in(function* ({ known }) {
			if (known.kind !== "Sealed") {
				return yield* result(blocked());
			}

			return yield* match([known.value, pattern])
				.with([{ type: "Neutral" }, P._], () => result(blocked()))
				.with([{ type: "Lit" }, { type: "Lit" }], ([value, p]) => result(_.isEqual(value.value, p.value) ? matched([]) : mismatch()))
				.with(
					[NF.Patterns.Array, { type: "List" }],
					([value, p]) => value.arg.row.type === "empty" && p.patterns.length === 0 && !p.rest,
					() => result(matched([])),
				)
				.with(
					[NF.Patterns.Array, { type: "List" }],
					([, p]) => p.patterns.length === 0 && !p.rest,
					() => result(mismatch()),
				)
				.with([NF.Patterns.Array, { type: "List" }], ([value, p]) => {
					const zip = function* (patterns: EB.Pattern[], row: NF.Row): Evaluation<Machine<Meet>> {
						if (patterns.length === 0) {
							if (!p.rest) {
								return yield* result(matched([]));
							}

							const binder: EB.Binder = { type: "Lambda", variable: p.rest };
							return yield* result(matched([{ binder, nf: NF.Constructors.Array(row) }]));
						}

						if (row.type !== "extension") {
							return yield* result(mismatch());
						}

						const [head, ...tail] = patterns;
						const remaining = row;

						return yield* Do.let("current", schedule.meet(head, remaining.value))
							.let("rest", zip(tail, remaining.row))
							.in(({ current, rest }) => result(combineMeet(current, rest)));
					};

					return zip(p.patterns, value.arg.row);
				})
				.with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], ([{ arg }, p]) => meetAll(p.row, arg.row))
				.with([NF.Patterns.Row, { type: "Row" }], ([value, p]) => meetAll(p.row, value.row))
				.with([NF.Patterns.Tagged, { type: "Variant", row: { type: "extension" } }], function* ([{ arg }, p]) {
					const value = NF.TaggedValue.extract(arg.row);
					if (!value) {
						return yield* result(mismatch());
					}

					const rewritten = R.rewrite(p.row, value.label);
					if (E.isLeft(rewritten) || rewritten.right.type !== "extension") {
						return yield* result(mismatch());
					}

					const arm = rewritten.right;

					return yield* Do.let("payload", schedule.meet(arm.value, value.payload))
						.let("rest", meetAll(arm.row, R.Constructors.Empty()))
						.in(({ payload, rest }) => result(combineMeet(payload, rest)));
				})
				.with([NF.Patterns.Variant, { type: "Variant" }], ([{ arg }, p]) => meetAll(p.row, arg.row))
				.with([NF.Patterns.HashMap, { type: "List" }], () => {
					console.warn("List pattern matching not yet implemented");
					return result(matched([]));
				})
				.with([NF.Patterns.Atom, { type: "Var" }], ([{ value }, p]) => result(value.value === p.value ? matched([]) : mismatch()))
				.otherwise(() => result(mismatch()));
		});
	},

	/**
	 * Forces to the first shape a consumer can inspect. Continuing at a solution or a contractum
	 * is handed back to the driver rather than delegated to, so a chain of residuals is a run of
	 * frames and a label or meta that resolves back to itself spends the machine's fuel.
	 */
	*force(value: NF.Value): Evaluation<Machine<NF.Value>> {
		/* A meta reached bare or under a Symbolic wrapper resolves the same way; only the route to it differs. */
		const solved = function* (meta: Extract<NF.Variable, { type: "Meta" }>): Evaluation<Machine<NF.Value>> {
			const solution = Metas.solution(yield* Metas.registry.get(), meta.val);

			return yield* solution ? step(schedule.force(solution)) : result(value);
		};

		/* Likewise a blocked elimination, wrapped or bare: retry it, and keep forcing while it progresses. */
		const retry = (subject: NF.Value): Evaluation<Machine<NF.Value>> =>
			Do.let("next", schedule.resume(subject)).in(({ next }) => (next === subject ? result(value) : schedule.force(next)));

		return yield* match(value)
			.with({ type: "Neutral", kind: "Sealed" }, () => result(value))
			.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label }, function* ({ value: label }) {
				const ctx = yield* M.reader.ask();

				const next = match(ctx.sigma[label.variable.name])
					.with({ value: { type: "Neutral", kind: "Symbolic", value: NF.Patterns.Label } }, ({ value: placeholder }) =>
						placeholder.value.variable.name === label.variable.name ? value : placeholder,
					)
					.with({ value: P.select() }, resolved => resolved)
					.otherwise(() => value);

				return yield* next === value ? result(value) : step(schedule.force(next));
			})
			.with({ type: "Neutral", kind: "Symbolic", value: NF.Patterns.Flex }, ({ value: flex }) => solved(flex.variable))
			.with({ type: "Neutral", kind: "Symbolic" }, () => result(value))
			.with({ type: "Neutral", kind: "Blocked" }, ({ value: blocked }) => retry(blocked))
			.with(NF.Patterns.Flex, ({ variable }) => solved(variable))
			.otherwise(() => retry(value));
	},

	/**
	 * Merges two modal annotations. Re-runs both liquid predicates against a shared rigid and
	 * conjoins them, which needs application and quotation, so it belongs to the machine rather
	 * than to verification — it is only ever reached from the Modal arm, mid-drive.
	 */
	*combine(a: Modal.Annotations<NF.Value>, b: Modal.Annotations<NF.Value>): Evaluation<Machine<Modal.Annotations<NF.Value>>> {
		assert(a.liquid.type === "Abs" && a.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");
		assert(b.liquid.type === "Abs" && b.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");

		const left = a.liquid;
		const right = b.liquid;
		const ctx = yield* M.reader.ask();
		const name = `${left.binder.variable}_and_${right.binder.variable}`;
		const lvl = ctx.env.length;

		return yield* Do.let("anf", schedule.apply(left.binder, left.closure, NF.Constructors.Rigid(lvl)))
			.let("bnf", schedule.apply(right.binder, right.closure, NF.Constructors.Rigid(lvl)))
			.in(({ anf, bnf }) =>
				Do.let("term", Quoting.quote(lvl + 1, DSL.Binop.and(anf, bnf))).in(({ term }) =>
					result({
						quantity: Q.SR.mul(a.quantity, b.quantity),
						liquid: NF.Constructors.Lambda(name, "Explicit", NF.Constructors.Closure(ctx, term), left.binder.annotation),
					}),
				),
			);
	},

	/**
	 * Forces, then reports which neutral kind the result presents. `force`, `view` and `resume`
	 * are the three requests a consumer makes of a value's neutral status, and this is the one
	 * that results in a classification rather than a value.
	 */
	*view(value: NF.Value): Evaluation<Machine<View>> {
		return yield* Do.let("forced", schedule.force(value)).in(({ forced }) =>
			result(
				match<NF.Value, View>(forced)
					.with({ type: "Neutral" }, ({ kind, value }) => ({ kind, value }))
					.otherwise(value => ({ kind: "Sealed", value })),
			),
		);
	},

	/**
	 * Retries one suspended elimination. Resulting in the value it was handed means nothing
	 * fired, which is the only signal needed: every arm forces what it inspects first, so a
	 * suspension that survives a retry is stable.
	 */
	*resume(value: NF.Value): Evaluation<Machine<NF.Value>> {
		return yield* match(value)
			.with(NF.Patterns.Proj, function* ({ base, label }) {
				return yield* Do.let("found", project(base, label)).in(({ found }) =>
					result(
						match(found)
							.with({ tag: "found" }, ({ value: projected }) => projected)
							.with({ tag: "missing" }, (): NF.Value => {
								throw new Error(`Projection: label ${label} not found`);
							})
							.otherwise(() => value),
					),
				);
			})
			.with(NF.Patterns.Match, function* ({ closure, scrutinee }) {
				assert(closure.type === "Closure", "Blocked match should retain a term closure");
				assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

				return yield* M.reader.local(_ => closure.ctx, schedule.matching(scrutinee, closure.term.alternatives, value));
			})
			.with(NF.Patterns.Inj, function* ({ base, label, injected }) {
				return yield* Do.let("replaced", inject(base, label, injected)).in(({ replaced }) => result(replaced ?? value));
			})
			.with(NF.Patterns.App, ({ func, arg, icit: appIcit }) =>
				Do.let("forced", schedule.force(func)).in(({ forced }) => (forced === func ? result(value) : schedule.reduce(forced, arg, appIcit))),
			)
			.with({ type: "External" }, function* (ext) {
				if (ext.args.length < ext.arity) {
					return yield* result(value);
				}

				return yield* group(
					ext.args.map(arg => schedule.force(arg)),
					function* (forced) {
						const changed = forced.some((arg, index) => arg !== ext.args[index]);

						if (forced.some(blocksExternal)) {
							return yield* result(changed ? NF.Constructors.Neutral("Blocked", NF.Constructors.External(ext.name, ext.arity, ext.compute, forced)) : value);
						}

						return yield* result(ext.compute(...forced.map(ignoreModal)));
					},
				);
			})
			.otherwise(() => result(value));
	},
};

/** The driven form of `schedule.reduce`, for consumers outside the evaluation path. */
export function* reduce(nff: NF.Value, nfa: NF.Value, icit: Implicitness): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.reduce(nff, nfa, icit),
		steps => `Reduction exceeded maximum steps (${steps}). Possible infinite loop applying: ${shown(ctx, () => display(nff))}`,
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
		steps => `Application exceeded maximum steps (${steps}). Possible infinite loop applying ${binder.variable} to: ${shown(ctx, () => display(value))}`,
	);
}

export type View = { kind: NF.Neutral; value: NF.Value };

/** The driven form of `schedule.resume`; getting the same value back means nothing fired. */
export function* resume(value: NF.Value): Evaluation<Option<NF.Value>> {
	const ctx = yield* M.reader.ask();
	const next = yield* drive(
		schedule.resume(value),
		steps => `Resumption exceeded maximum steps (${steps}). Possible infinite loop resuming: ${shown(ctx, () => display(value))}`,
	);

	return next === value ? O.none : O.some(next);
}

/** The driven form of `schedule.force`, for consumers outside the evaluation path. */
export function* force(value: NF.Value): Evaluation<NF.Value> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.force(value),
		steps => `Forcing exceeded maximum steps (${steps}). Possible cycle in a label or meta solution for: ${shown(ctx, () => display(value))}`,
	);
}

export function* view(value: NF.Value): Evaluation<View> {
	const ctx = yield* M.reader.ask();

	return yield* drive(
		schedule.view(value),
		steps => `Observation exceeded maximum steps (${steps}). Possible cycle in a label or meta solution for: ${shown(ctx, () => display(value))}`,
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

export const ignoreModal = (value: NF.Value): NF.Value => {
	return match(value)
		.with({ type: "Modal" }, ({ value }) => ignoreModal(value))
		.otherwise(() => value);
};

const blocksExternal = (value: NF.Value): boolean =>
	match(ignoreModal(value))
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

const meetAll = function* (pats: R.Row<EB.Pattern, string>, vals: NF.Row): Evaluation<Machine<Meet>> {
	return yield* match([pats, vals])
		.with([{ type: "empty" }, P._], () => result(matched([])))
		.with([{ type: "variable" }, P._], ([r, tail]) => {
			const binder: EB.Binder = { type: "Lambda", variable: r.variable };
			return result(matched([{ binder, nf: NF.Constructors.Row(tail) }]));
		})
		.with([{ type: "extension" }, { type: "empty" }], [{ type: "extension" }, { type: "variable" }], () => result(mismatch()))
		.with([{ type: "extension" }, { type: "extension" }], function* ([r1, r2]) {
			const rewritten = R.rewrite(r2, r1.label);
			if (E.isLeft(rewritten)) {
				return yield* result(mismatch());
			}

			if (rewritten.right.type !== "extension") {
				throw new Error("Rewriting a row extension should result in another row extension");
			}

			const tail = rewritten.right;

			return yield* Do.let("current", schedule.meet(r1.value, tail.value))
				.let("rest", meetAll(r1.row, tail.row))
				.in(({ current, rest }) => result(combineMeet(current, rest)));
		})
		.exhaustive();
};

/**
 * The driven form: runs the observation on the machine and results in the verdict it reached.
 * A verdict is not an `NF.Value`, so it cannot come back over the result stack; the terminal
 * continuation hands it out instead.
 */
export function* meet(pattern: EB.Pattern, nf: NF.Value): Evaluation<Meet> {
	return yield* drive(schedule.meet(pattern, nf), steps => `Pattern observation exceeded maximum steps (${steps}).`);
}
