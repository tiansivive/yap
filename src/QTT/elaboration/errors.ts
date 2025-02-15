import * as NF from "@qtt/elaboration/normalization";

export type Cause =
	| { type: "UnificationFailure"; left: NF.Value; right: NF.Value }
	| { type: "RigidVariableMismatch"; left: NF.Value; right: NF.Value }
	| { type: "TypeMismatch"; left: NF.Value; right: NF.Value };

export const UnificationFailure = (left: NF.Value, right: NF.Value): Cause => ({ type: "UnificationFailure", left, right });
export const RigidVariableMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "RigidVariableMismatch", left, right });
export const TypeMismatch = (left: NF.Value, right: NF.Value): Cause => ({ type: "TypeMismatch", left, right });

export const display = (error: Cause): string => {
	switch (error.type) {
		case "UnificationFailure":
			return `Unification Failure: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
		case "RigidVariableMismatch":
			return `Variable Mismatch: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
		case "TypeMismatch":
			return `Type Mismatch: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
	}
};
