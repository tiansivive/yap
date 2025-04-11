import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";

export type Cause =
	| { type: "UnificationFailure"; left: NF.Value; right: NF.Value }
	| { type: "RigidVariableMismatch"; left: NF.Value; right: NF.Value }
	| { type: "RowMismatch"; left: NF.Row; right: NF.Row; reason: string }
	| { type: "MissingLabel"; label: string }
	| { type: "TypeMismatch"; left: NF.Value; right: NF.Value }
	| { type: "Impossible"; message: string; extra?: any }
	| { type: "MultiplicityMismatch"; expected: Q.Multiplicity; right: Q.Multiplicity; reason?: string };

export const UnificationFailure = (left: NF.Value, right: NF.Value): Cause => ({ type: "UnificationFailure", left, right });
export const RigidVariableMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "RigidVariableMismatch", left, right });
export const RowMismatch = (left: NF.Row, right: NF.Row, reason: string): Cause => ({ type: "RowMismatch", left, right, reason });
export const TypeMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "TypeMismatch", left, right });
export const Impossible = (message: string, extra?: any): Cause => ({ type: "Impossible", message, extra });
export const MissingLabel = (label: string): Cause => ({ type: "MissingLabel", label });
export const MultiplicityMismatch = (expected: Q.Multiplicity, right: Q.Multiplicity, reason?: string): Cause => ({
	type: "MultiplicityMismatch",
	expected,
	right,
	reason,
});

export const display = (error: Cause): string => {
	switch (error.type) {
		case "UnificationFailure":
			return `Unification Failure: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
		case "RigidVariableMismatch":
			return `Variable Mismatch: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
		case "RowMismatch":
			return `Row Mismatch: Cannot unify\n${R.display({ term: NF.display, var: v => JSON.stringify(v) })(error.left)}\nwith\n${R.display({ term: NF.display, var: v => JSON.stringify(v) })(error.right)}.\nReason: ${error.reason}`;
		case "TypeMismatch":
			return `Type Mismatch: Cannot unify:\n\t${NF.display(error.left)}\nwith\n\t${NF.display(error.right)}`;
		case "Impossible":
			return `Impossible! ${error.message}`;
		case "MissingLabel":
			return `Missing Label: ${error.label}`;
		case "MultiplicityMismatch":
			return `Multiplicity Mismatch: Expected "${Q.display(error.expected)}" but got "${Q.display(error.right)}".`;
	}
};
