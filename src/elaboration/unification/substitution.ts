import * as NF from "@yap/elaboration/normalization";

import * as Eff from "@yap/utils/effects";
import * as M from "../shared/effects";
import * as Metas from "../shared/metas";
import type { Display } from "../pretty/pretty";

const Substitution: unique symbol = Symbol("Substitution");
export type Subst = Record<number, NF.Value> & { [Substitution]: void };

export const empty: Subst = { [Substitution]: void 0 };
export const of = (k: number, v: NF.Value): Subst => ({ [k]: v, [Substitution]: void 0 });
export const from = (record: Record<number, NF.Value>): Subst => ({ ...record, [Substitution]: void 0 });

export const display = function* (subst: Subst, separator = "\n"): Display<string> {
	if (Object.keys(subst).length === 0) {
		return "empty";
	}

	// Overlay the substitution onto the registry so nested metas resolve through it; scoped, never committed.
	const current = yield* Metas.registry.get();
	const [entries] = yield* Eff.with([Metas.registry.handlers(Metas.withSolutions(current, subst))], () =>
		M.reader.local(
			ctx => ({ ...ctx, env: [] }),
			Eff.traverse(Object.entries(subst), function* ([key, value]) {
				return `?${key} |=> ${yield* NF.display(value)}`;
			}),
		),
	);

	return entries.join(separator);
};

/*
 * The unification accumulator as an ambient capability. One instance
 * module-wide: an action's identity is its tag. The handler owns the
 * accumulator; the boundary that installs it reads the final substitution
 * off the handler's output and decides whether to commit it.
 */
type Get = Eff.Action<"Subst.get", undefined, Subst>;
type Bind = Eff.Action<"Subst.bind", Subst, Subst>;

const get = function* () {
	return yield* Eff.ctl.action<Get>("Subst.get", undefined);
};

/** Composes new bindings over the accumulator; answers the result. */
const bind = function* (sub: Subst) {
	return yield* Eff.ctl.action<Bind>("Subst.bind", sub);
};

const handlers = (initial: Subst = empty): Eff.Handler<Get | Bind, Subst> => {
	/* eslint-disable no-restricted-syntax -- this handler owns the accumulator */
	let current = initial;

	return {
		clauses: {
			"Subst.get": () => Eff.ctl.resume(current),

			"Subst.bind": sub => {
				current = compose(sub, current);

				return Eff.ctl.resume(current);
			},
		},

		output: () => current,
	};
	/* eslint-enable no-restricted-syntax */
};

export const subst = { get, bind, handlers };

export function compose(newer: Subst, old: Subst): Subst;
export function compose(old: Subst): (newer: Subst) => Subst;
export function compose(...args: [Subst, Subst] | [Subst]) {
	const _compose = (newer: Subst, old: Subst): Subst => ({ ...old, ...newer });

	if (args.length === 1) {
		return (newer: Subst) => _compose(newer, args[0]);
	}

	return _compose(args[0], args[1]);
}
