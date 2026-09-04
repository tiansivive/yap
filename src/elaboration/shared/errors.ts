import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as M from "./effects";
import * as P from "./provenance";
import type { Display } from "../pretty/pretty";

export type Cause =
	| { type: "UnificationFailure"; left: NF.Value; right: NF.Value }
	| { type: "RigidVariableMismatch"; left: NF.Value; right: NF.Value }
	| { type: "RowMismatch"; left: NF.Row; right: NF.Row; reason: string }
	| { type: "MissingLabel"; label: string; row: R.Row<any, any> }
	| { type: "TypeMismatch"; left: NF.Value; right: NF.Value }
	| { type: "Impossible"; message: string; extra?: any }
	| { type: "MultiplicityMismatch"; expected: Q.Multiplicity; right: Q.Multiplicity; reason?: string };

export const UnificationFailure = (left: NF.Value, right: NF.Value): Cause => ({ type: "UnificationFailure", left, right });
export const RigidVariableMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "RigidVariableMismatch", left, right });
export const RowMismatch = (left: NF.Row, right: NF.Row, reason: string): Cause => ({ type: "RowMismatch", left, right, reason });
export const TypeMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "TypeMismatch", left, right });
export const Impossible = (message: string, extra?: any): Cause => ({ type: "Impossible", message, extra });
export const MissingLabel = <T, V>(label: string, row: R.Row<T, V>): Cause => ({ type: "MissingLabel", label, row });
export const MultiplicityMismatch = (expected: Q.Multiplicity, right: Q.Multiplicity, reason?: string): Cause => ({
	type: "MultiplicityMismatch",
	expected,
	right,
	reason,
});

/** Errors display under an empty scope: their values quote against no binders. */
export const display = (error: Cause): Display<string> => M.reader.local(ctx => ({ ...ctx, env: [] }), rendered(error));

/**
 * A raised error: its cause, and the provenance stack it was raised under.
 *
 * `display` answers for a bare cause; anything holding an `M.Err` wants this, since
 * the trace is most of what makes a type error readable.
 */
export const report = function* (error: Cause & { provenance?: readonly P.Provenance[] }): Display<string> {
	const cause = yield* display(error);
	const trace = error.provenance?.length ? yield* P.display(error.provenance, { cap: 100 }) : "";

	return trace ? `${cause}\n\nTrace:\n${trace}` : cause;
};

const rendered = function* (error: Cause): Display<string> {
	switch (error.type) {
		case "UnificationFailure":
			return `Unification Failure: Cannot unify ${yield* NF.display(error.left)} with ${yield* NF.display(error.right)}`;
		case "RigidVariableMismatch":
			return `Variable Mismatch: Cannot unify ${yield* NF.display(error.left)} with ${yield* NF.display(error.right)}`;
		case "RowMismatch":
			return `Row Mismatch: Cannot unify\n${yield* NF.display(NF.Constructors.Row(error.left))}\nwith\n${yield* NF.display(NF.Constructors.Row(error.right))}.\nReason: ${error.reason}`;
		case "TypeMismatch":
			return `Type Mismatch: Cannot unify:\n\t${yield* NF.display(error.left)}\nwith\n\t${yield* NF.display(error.right)}`;
		case "Impossible":
			return `Impossible! ${error.message}`;
		case "MissingLabel":
			return `Missing Label: ${error.label}`;
		case "MultiplicityMismatch":
			return `Multiplicity Mismatch: Expected "${Q.display(error.expected)}" but got "${Q.display(error.right)}".`;
	}
};
