/* eslint-disable no-restricted-syntax -- the handlers own their cells (indentation, obligations, name supplies); their clauses are the only way to move them */
import * as Eff from "@yap/utils/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as M from "@yap/elaboration/shared/effects";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { getMonoid } from "fp-ts/Array";
import type * as Horn from "../horn";
import type { IVL } from "../solver/ivl/types";
import type { Obligation } from "./types";
import { P } from "ts-pattern";

/*
 * The verification row. Metacontext state solutions, reader
 * for scope, abort for impossible/missing-label, plus three
 * verification-internal effects: a debug logger, an obligation collector,
 * and a fresh-name supply.
 */

// ─── Logger ──────────────────────────────────────────────────────────────────
//
// Indented debug printer gated by a flag. The handler owns the indentation
// counter; a disabled handler resumes as a no-op. Not a reusable utility —
// this is verification's own concern.

type LogAction = Eff.Action<"VC.log", readonly string[], void>;
type EnterAction = Eff.Action<"VC.enter", undefined, void>;
type ExitAction = Eff.Action<"VC.exit", undefined, void>;

type LoggerActions = LogAction | EnterAction | ExitAction;

const log = function* (...msgs: string[]) {
	return yield* Eff.ctl.action<LogAction>("VC.log", msgs);
};

const enter = function* () {
	return yield* Eff.ctl.action<EnterAction>("VC.enter", undefined);
};

const exit = function* () {
	return yield* Eff.ctl.action<ExitAction>("VC.exit", undefined);
};

const loggerHandlers = (logging: boolean): Eff.Handler<LoggerActions, undefined> => {
	let indentation = 0;
	const prefix = () => `${"|" + "\t"}`.repeat(indentation);

	return {
		clauses: {
			"VC.log": msgs => {
				if (logging) {
					const p = prefix();
					console.log(p + msgs.join("\n" + " \t".repeat(indentation)));
				}
				return Eff.ctl.resume(undefined);
			},
			"VC.enter": () => {
				indentation++;
				return Eff.ctl.resume(undefined);
			},
			"VC.exit": () => {
				indentation = Math.max(0, indentation - 1);
				return Eff.ctl.resume(undefined);
			},
		},
		output: () => undefined,
	};
};

export const logger = { log, enter, exit, handlers: loggerHandlers };

// ─── Obligations ─────────────────────────────────────────────────────────────
//
// Writer-style collector for verification obligations. `record` accumulates
// an Obligation and returns the formula unchanged — tell + identity.

type RecordAction = Eff.Action<"VC.record", { label: string; expr: IVL.Formula; context?: Obligation["context"] }, IVL.Formula>;

const record = function* (label: string, expr: IVL.Formula, context?: Obligation["context"]) {
	return yield* Eff.ctl.action<RecordAction>("VC.record", { label, expr, context });
};

const obligationsHandlers = (): Eff.Handler<RecordAction, Obligation[]> => {
	const collected: Obligation[] = [];

	return {
		clauses: {
			"VC.record": ({ label, expr, context }) => {
				collected.push({ label, expr, context });
				return Eff.ctl.resume(expr);
			},
		},
		output: () => [...collected],
	};
};

export const obligations = { record, handlers: obligationsHandlers };

// ─── Supply ──────────────────────────────────────────────────────────────────

type FreshAction = Eff.Action<"VC.fresh", undefined, string>;
type FreshNumAction = Eff.Action<"VC.freshNum", undefined, string>;
type FreshFromAction = Eff.Action<"VC.freshFrom", string, string>;

type LevelAction = Eff.Action<"VC.level", string, number>;
type SupplyActions = FreshAction | FreshNumAction | FreshFromAction | LevelAction;

const fresh = function* () {
	return yield* Eff.ctl.action<FreshAction>("VC.fresh", undefined);
};

const freshNum = function* () {
	return yield* Eff.ctl.action<FreshNumAction>("VC.freshNum", undefined);
};

const freshFrom = function* (variable: string) {
	return yield* Eff.ctl.action<FreshFromAction>("VC.freshFrom", variable);
};

const bumpAlpha = (s: string): string => {
	let carry = 1;
	let res = "";
	for (let i = s.length - 1; i >= 0; i--) {
		const v = s.charCodeAt(i) - 97 + carry;
		if (v >= 26) {
			res = "a" + res;
			carry = 1;
		} else {
			res = String.fromCharCode(97 + v) + res;
			carry = 0;
		}
	}
	if (carry) {
		res = "a" + res;
	}
	return res;
};

const supplyHandlers = (): Eff.Handler<SupplyActions, undefined> => {
	const levels = new Map<string, number>();
	let alphaSeq = "a";
	let numSeq = 0;
	let fromSeq = 0;

	return {
		clauses: {
			"VC.level": name => {
				const lvl = levels.get(name) ?? levels.size;
				levels.set(name, lvl);
				return Eff.ctl.resume(lvl);
			},
			"VC.fresh": () => {
				const name = `$${alphaSeq}`;
				alphaSeq = bumpAlpha(alphaSeq);
				return Eff.ctl.resume(name);
			},
			"VC.freshNum": () => {
				const name = `$fresh${numSeq}`;
				numSeq++;
				return Eff.ctl.resume(name);
			},
			"VC.freshFrom": variable => {
				const name = `${variable}!${fromSeq}`;
				fromSeq++;
				return Eff.ctl.resume(name);
			},
		},
		output: () => undefined,
	};
};

export const supply = { fresh, freshNum, freshFrom, level: (name: string) => Eff.ctl.action<LevelAction>("VC.level", name), handlers: supplyHandlers };

export const names = Eff.reader<ReadonlyMap<number, string>, "VC.Names">("VC.Names");
export const state = Eff.reader<NF.Value, "VC.State">("VC.State");
export const definitions = Eff.reader<ReadonlyMap<number, NF.Value>, "VC.Definitions">("VC.Definitions");

export const hypotheses = Eff.reader<Horn.Scope, "VC.Hypotheses">("VC.Hypotheses");
export const constraints = Eff.writer(getMonoid<Horn.Constraint>());

export type Hypothesis = { binder: IVL.Binder; premise?: IVL.Formula; formal: Horn.Binder; condition?: NF.Value };

export const extend =
	(...entries: Hypothesis[]) =>
	(scope: Horn.Scope): Horn.Scope => ({
		binders: [...scope.binders, ...entries.map(entry => entry.formal)],
		premises: [...scope.premises, ...entries.flatMap(entry => (entry.condition ? [entry.condition] : []))],
	});

const heads = { empty: "$empty", insert: "$insert" } as const;

export const State = {
	heads,
	Patterns: {
		empty: { ...NF.Patterns.External, name: heads.empty, arity: 0, args: [] },
		insert: { ...NF.Patterns.External, name: heads.insert, arity: 3, args: [P._, P._, P._] },
	} as const,
	insert: function* (current: NF.Value, identity: NF.Value, annotation: NF.Value) {
		const head = yield* NF.evaluate(EB.DSL.foreign(heads.insert));
		const typed = yield* NF.reduce(head, annotation, "Explicit");
		const previous = yield* NF.reduce(typed, current, "Explicit");
		return yield* NF.reduce(previous, identity, "Explicit");
	},
};

// ─── Row ─────────────────────────────────────────────────────────────────────

export type Verification<A> = Eff.Eff<
	| Eff.Actions<typeof reader>
	| Eff.Actions<typeof names>
	| Eff.Actions<typeof Metas.registry>
	| Eff.Actions<typeof M.supply>
	| Eff.Actions<typeof state>
	| Eff.Actions<typeof definitions>
	| Eff.Actions<typeof hypotheses>
	| Eff.Actions<typeof constraints>
	| Eff.Actions<typeof except>
	| LoggerActions
	| RecordAction
	| SupplyActions,
	A
>;

export const reader = M.reader;
export const except = Eff.except<M.Err>();
export type Err = M.Err;

export const fail = function* (cause: import("@yap/elaboration/shared/errors").Cause) {
	const ctx = yield* reader.ask();
	return yield* except.raise({ ...cause, ctx });
};

// ─── Runner ──────────────────────────────────────────────────────────────────

export type VerificationOptions = { logging?: boolean; state?: NF.Value };

export const run = <A>(ctx: EB.Context, registry: Metas.Registry, program: () => Verification<A>, options: VerificationOptions = {}) => {
	const foreign = (name: string, arity: number) => {
		const compute = (...args: NF.Value[]): NF.Value => NF.Constructors.Neutral("Sealed", NF.Constructors.External(name, arity, compute, args));
		return { arity, compute };
	};
	const insert = NF.Constructors.Pi(
		"E",
		"Explicit",
		NF.Type,
		NF.Constructors.Closure(ctx, EB.Constructors.Pi("s", "Explicit", EB.State, EB.Constructors.Pi("e", "Explicit", EB.DSL.bound(1), EB.State))),
	);
	const context = {
		...ctx,
		imports: {
			...ctx.imports,
			[State.heads.empty]: [EB.Constructors.Var({ type: "Foreign", name: State.heads.empty }), NF.State, []] satisfies EB.AST,
			[State.heads.insert]: [EB.Constructors.Var({ type: "Foreign", name: State.heads.insert }), insert, []] satisfies EB.AST,
		},
		ffi: {
			...ctx.ffi,
			[State.heads.empty]: foreign(State.heads.empty, 0),
			[State.heads.insert]: foreign(State.heads.insert, 3),
		},
	};
	const initialized = function* () {
		const outer = yield* Eff.traverse([...ctx.env].reverse(), entry => supply.freshFrom(entry.name.variable));
		return yield* names.local(() => new Map(outer.map((name, lvl) => [lvl, name])), program());
	};
	const [answer, , registrySnapshot, , , collected, emitted] = Eff.run(initialized, [
		reader.handlers(context),
		Metas.registry.handlers(registry),
		except.handlers(),
		logger.handlers(options.logging ?? false),
		obligations.handlers(),
		constraints.handlers(),
		hypotheses.handlers({ binders: [], premises: [] }),
		supply.handlers(),
		names.handlers(new Map()),
		state.handlers(options.state ?? context.ffi[State.heads.empty].compute()),
		definitions.handlers(new Map()),
		M.supply.handlers({ meta: Object.values(registry).reduce((max, entry) => Math.max(max, entry.meta.val), 0) }),
	]);

	return { answer, obligations: collected, constraints: emitted.slice(), registry: registrySnapshot } as const;
};
