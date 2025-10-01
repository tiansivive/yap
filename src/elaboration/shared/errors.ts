import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as EB from "@yap/elaboration";

export type Cause =
	| { type: "UnificationFailure"; left: NF.Value; right: NF.Value }
	| { type: "RigidVariableMismatch"; left: NF.Value; right: NF.Value }
	| { type: "RowMismatch"; left: NF.Row; right: NF.Row; reason: string }
	| { type: "MissingLabel"; label: string; row: NF.Row }
	| { type: "TypeMismatch"; left: NF.Value; right: NF.Value }
	| { type: "Impossible"; message: string; extra?: any }
	| { type: "MultiplicityMismatch"; expected: Q.Multiplicity; right: Q.Multiplicity; reason?: string };

export const UnificationFailure = (left: NF.Value, right: NF.Value): Cause => ({ type: "UnificationFailure", left, right });
export const RigidVariableMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "RigidVariableMismatch", left, right });
export const RowMismatch = (left: NF.Row, right: NF.Row, reason: string): Cause => ({ type: "RowMismatch", left, right, reason });
export const TypeMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "TypeMismatch", left, right });
export const Impossible = (message: string, extra?: any): Cause => ({ type: "Impossible", message, extra });
export const MissingLabel = (label: string, row: NF.Row): Cause => ({ type: "MissingLabel", label, row });
export const MultiplicityMismatch = (expected: Q.Multiplicity, right: Q.Multiplicity, reason?: string): Cause => ({
	type: "MultiplicityMismatch",
	expected,
	right,
	reason,
});

export const display = (error: Cause, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	switch (error.type) {
		case "UnificationFailure":
			return `Unification Failure: Cannot unify ${NF.display(error.left, zonker, metas)} with ${NF.display(error.right, zonker, metas)}`;
		case "RigidVariableMismatch":
			return `Variable Mismatch: Cannot unify ${NF.display(error.left, zonker, metas)} with ${NF.display(error.right, zonker, metas)}`;
		case "RowMismatch":
			return `Row Mismatch: Cannot unify\n${R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, zonker, metas), var: v => JSON.stringify(v) })(error.left)}\nwith\n${R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, zonker, metas), var: v => JSON.stringify(v) })(error.right)}.\nReason: ${error.reason}`;
		case "TypeMismatch":
			return `Type Mismatch: Cannot unify:\n\t${NF.display(error.left, zonker, metas)}\nwith\n\t${NF.display(error.right, zonker, metas)}`;
		case "Impossible":
			return `Impossible! ${error.message}`;
		case "MissingLabel":
			return `Missing Label: ${error.label}`;
		case "MultiplicityMismatch":
			return `Multiplicity Mismatch: Expected "${Q.display(error.expected)}" but got "${Q.display(error.right)}".`;
	}
};
