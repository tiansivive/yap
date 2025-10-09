import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

const Substitution: unique symbol = Symbol("Substitution");
export type Subst = Record<number, NF.Value> & { [Substitution]: void };

export const empty: Subst = { [Substitution]: void 0 };
export const of = (k: number, v: NF.Value): Subst => ({ [k]: v, [Substitution]: void 0 });
export const from = (record: Record<number, NF.Value>): Subst => ({ ...record, [Substitution]: void 0 });

export const display = (subst: Subst, metas: EB.Context["metas"], separator = "\n"): string => {
	if (Object.keys(subst).length === 0) {
		return "empty";
	}
	return Object.entries(subst)
		.map(([key, value]) => `?${key} |=> ${NF.display(value, { zonker: subst, metas, env: [] })}`)
		.join(separator);
};

export function compose(newer: Subst, old: Subst): Subst;
export function compose(old: Subst): (newer: Subst) => Subst;
export function compose(...args: [Subst, Subst] | [Subst]) {
	const _compose = (newer: Subst, old: Subst): Subst => ({ ...old, ...newer });

	if (args.length === 1) {
		return (newer: Subst) => _compose(newer, args[0]);
	}

	return _compose(args[0], args[1]);
}
