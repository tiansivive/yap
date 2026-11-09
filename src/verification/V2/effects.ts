/* eslint-disable no-restricted-syntax -- the handlers own their cells (indentation, obligations, name supplies); their clauses are the only way to move them */
import * as Eff from "@yap/utils/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as M from "@yap/elaboration/shared/effects";

import type * as EB from "@yap/elaboration";
import type { IVL } from "../solver/ivl/types";
import type { Obligation } from "./types";

/*
 * The verification row. Read-only metacontext (no register/modify), reader
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

type SupplyActions = FreshAction | FreshNumAction | FreshFromAction;

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
	let alphaSeq = "a";
	let numSeq = 0;
	let fromSeq = 0;

	return {
		clauses: {
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

export const supply = { fresh, freshNum, freshFrom, handlers: supplyHandlers };

export const names = Eff.reader<ReadonlyMap<number, string>, "VC.Names">("VC.Names");

// ─── Row ─────────────────────────────────────────────────────────────────────

export type Verification<A> = Eff.Eff<
	| Eff.Actions<typeof reader>
	| Eff.Actions<typeof names>
	| Eff.Only<typeof Metas.registry, "Registry.get">
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

export type VerificationOptions = { logging?: boolean };

export const run = <A>(ctx: EB.Context, registry: Metas.Registry, program: () => Verification<A>, options: VerificationOptions = {}) => {
	const initialized = function* () {
		const outer = yield* Eff.traverse([...ctx.env].reverse(), entry => supply.freshFrom(entry.name.variable));
		return yield* names.local(() => new Map(outer.map((name, lvl) => [lvl, name])), program());
	};
	const [answer, , registrySnapshot, , , collected] = Eff.run(initialized, [
		reader.handlers(ctx),
		Metas.registry.handlers(registry),
		except.handlers(),
		logger.handlers(options.logging ?? false),
		obligations.handlers(),
		supply.handlers(),
		names.handlers(new Map()),
	]);

	return { answer, obligations: collected, registry: registrySnapshot } as const;
};
