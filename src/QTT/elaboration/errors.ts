import * as NF from "@qtt/elaboration/normalization";

export type Cause = { type: "UnificationFailure"; left: NF.Value; right: NF.Value };

export const UnificationFailure = (left: NF.Value, right: NF.Value): Error => {
	const cause: Cause = { type: "UnificationFailure", left, right };

	return new Error(display(cause), { cause });
};

const display = (error: Cause): string => {
	switch (error.type) {
		case "UnificationFailure":
			return `Unification Failure: Cannot unify ${NF.display(error.left)} with ${NF.display(error.right)}`;
	}
};
