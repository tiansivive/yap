import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";

import type { References } from "./record";

/**
 * Rejects a record that cannot be built in any order, by the same rule as OCaml's `let rec`.
 * Outside a lambda, no field of the record may be applied as a function, and fields may not read
 * each other in a cycle. A lambda body runs only once the record exists, so references inside one
 * are always allowed.
 */
export const acyclic = function* (references: References): M.Elaboration<void> {
	const unguarded = Object.fromEntries(Object.entries(references).map(([label, refs]) => [label, refs.filter(({ guarded }) => !guarded)]));
	const call = Object.values(unguarded)
		.flat()
		.find(({ applied }) => applied);
	if (call) {
		return yield* M.fail(Err.RecordCall(call.label));
	}

	const found = cycle(unguarded);
	if (found) {
		return yield* M.fail(Err.RecordCycle(found));
	}
};

const cycle = (edges: References): string[] | undefined => {
	const visit = (label: string, path: readonly string[]): string[] | undefined =>
		path.includes(label) ? [...path.slice(path.indexOf(label)), label] : edges[label]?.map(({ label: next }) => visit(next, [...path, label])).find(Boolean);

	return Object.keys(edges)
		.map(label => visit(label, []))
		.find(Boolean);
};
