import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as U from "@yap/elaboration/unification";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import * as Sub from "@yap/elaboration/unification/substitution";

import { WithProvenance } from "../shared/provenance";

import _ from "lodash";

export type Constraint =
	| { type: "assign"; left: NF.Value; right: NF.Value; lvl: number }
	//| { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity }
	| { type: "resolve"; meta: EB.Meta; value: NF.Value; implicits: EB.Context["implicits"] };

type Ctaint = WithProvenance<Constraint>;

/** Solving's row: unification's, minus the accumulator it installs itself, plus the commit write. */
export type Solving<A> = Eff.Eff<
	| Eff.Actions<typeof M.reader>
	| Eff.Actions<typeof Metas.registry>
	| Eff.Actions<typeof M.supply>
	| Eff.Actions<typeof M.except>
	| Eff.Actions<typeof M.tracer>,
	A
>;

export type Resolutions = Record<number, NF.Value>;

/**
 * Solves the assign constraints under one accumulator and commits the final
 * substitution to the registry; failure aborts to whoever delimits the raise.
 * Resolutions never commit — an implicit candidate is accepted only when its
 * unification binds nothing (see resolve).
 */
export const solve = function* (cs: Array<Ctaint>): Solving<{ resolutions: Resolutions }> {
	const unifications = cs.filter(c => c.type === "assign");

	const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => _solve(unifications));
	yield* Metas.registry.modify(current => Metas.withSolutions(current, subst));

	const resolutions = yield* resolve(cs.filter(c => c.type === "resolve"));

	return { resolutions };
};

const _solve = function* (cs: Array<Ctaint>): U.Unification<void> {
	if (cs.length === 0) {
		return;
	}

	const [c, ...rest] = cs;

	yield* match(c)
		.with({ type: "assign" }, ({ left, right, lvl, trace }) => M.tracer.track(trace, () => U.unify(left, right, lvl)))
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});

	yield* _solve(rest);
};

/** Delimits a candidate attempt: a raise answers this scope instead of the run. */
const attempted: Eff.Handler<Eff.Actions<typeof M.except>, undefined, M.Err> = {
	clauses: { "Except.raise": error => Eff.ctl.abort(error) },
	output: () => undefined,
};

const resolve = function* (cs: Array<Extract<Constraint, { type: "resolve" }>>): Solving<Resolutions> {
	const ctx = yield* M.reader.ask();

	const lookup = function* (implicits: EB.Context["implicits"], nf: NF.Value): Solving<NF.Value | undefined> {
		if (implicits.length === 0) {
			return undefined;
		}

		const [[term, value], ...rest] = implicits;
		const [outcome, subst] = yield* Eff.with([attempted, Sub.subst.handlers()], () => U.unify(nf, value, ctx.env.length));

		if (!Eff.failed(outcome) && _.isEmpty(subst)) {
			return term;
		}

		// NOTE: Don't accept an implicit whose unification binds anything.
		// Non-empty substitutions mean this implicit would prematurely instantiate other metas, reducing polymorphism.
		// By continuing to search, we preserve generalization opportunity for those metas.
		// This aligns with how Idris2 and Lean handle implicit resolution: defer decisions that constrain other unknowns.
		return yield* lookup(rest, nf);
	};

	const _resolve = function* (constraints: Array<Extract<Constraint, { type: "resolve" }>>): Solving<Resolutions> {
		if (constraints.length === 0) {
			return {};
		}

		const [{ implicits, value, meta }, ...rest] = constraints;

		const registry = yield* Metas.registry.get();

		if (Metas.solution(registry, meta.val)) {
			// Already resolved
			return yield* _resolve(rest);
		}

		const found = yield* lookup(implicits, yield* NF.force(value));

		if (!found) {
			return yield* _resolve(rest);
		}

		const solution = yield* _resolve(rest);

		return { ...solution, [meta.val]: found };
	};

	return yield* _resolve(cs);
};
