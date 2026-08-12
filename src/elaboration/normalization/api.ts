import * as Eff from "@yap/utils/effects";

import type * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import type { Implicitness } from "@yap/shared/implicitness";

import * as Arity from "./arity";
import * as Machine from "./evaluation.v2";
import * as Quoting from "./quoting";
import * as Recursion from "./recursion";
import { callstack, Evaluation } from "./callstack";
import type { Closure, Value } from "./syntax/term";

/*
 * The consumer-facing surface. Each entry installs a fresh machine via
 * Eff.with, so the callstack never appears in a consumer's row — NbE owns
 * it; elaboration knows nothing about it.
 *
 * Fresh-per-entry is exact: the old shared global stack was provably empty
 * between external entries (drives are balanced), so only mid-drive
 * re-entry ever observed a shared non-empty stack — and that path stays on
 * the ambient machine inside the internal layer.
 */

/** Runs an internal-layer program on a fresh machine. */
function* fresh<A>(program: () => Evaluation<A>) {
	const [value] = yield* Eff.with([callstack.handlers()], program);

	return value;
}

/** The elaboration-facing entry, and the NbE-mode toggle point. */
export function* normalize(term: EB.Term, opts?: Machine.EvalOptions) {
	return yield* fresh(() => Machine.evaluate(term, opts));
}

export function* evaluate(term: EB.Term, opts?: Machine.EvalOptions) {
	return yield* fresh(() => Machine.evaluate(term, opts));
}

export function* quote(lvl: number, val: Value) {
	return yield* fresh(() => Quoting.quote(lvl, val));
}

export function* closeVal(value: Value) {
	return yield* fresh(() => Quoting.closeVal(value));
}

export function* force(value: Value) {
	return yield* fresh(() => Machine.force(value));
}

export function* view(value: Value) {
	return yield* fresh(() => Machine.view(value));
}

export function* resume(value: Value) {
	return yield* fresh(() => Machine.resume(value));
}

export function* matching(nf: Value, alts: EB.Alternative[]) {
	return yield* fresh(() => Machine.matching(nf, alts));
}

export function* apply(binder: EB.Binder, closure: Closure, value: Value) {
	return yield* fresh(() => Machine.apply(binder, closure, value));
}

export function* reduce(nff: Value, nfa: Value, icit: Implicitness) {
	return yield* fresh(() => Machine.reduce(nff, nfa, icit));
}

export function* arity(ty: Value) {
	return yield* fresh(() => Arity.arity(ty));
}

export function* unfoldMu(app: Extract<Value, { type: "App" }>) {
	return yield* fresh(() => Recursion.unfoldMu(app));
}

/**
 * A read-only probe: runs one public entry against snapshots of the scope and
 * metacontext, discarding the run. For guard positions — a guard is a plain
 * function and cannot yield, and a nested Eff.run is a plain expression.
 * Sound because the public row is reader | Registry.get: the program provably
 * writes nothing, and with no except in the row the answer cannot be an abort.
 */
export const probe =
	(ctx: EB.Context, registry: Metas.Registry) =>
	<A>(program: () => Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Only<typeof Metas.registry, "Registry.get">, A>): A => {
		const [answer] = Eff.run(program, [M.reader.handlers(ctx), Metas.registry.handlers(registry)]);

		return answer;
	};

export { meet, unwrapNeutral, ignoraModal, builtinsOps } from "./evaluation.v2";
export type { View, MeetResult, EvalOptions } from "./evaluation.v2";
export { inert } from "./arity";
