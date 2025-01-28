import * as NF from "./normalization";

import * as Q from "@qtt/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@qtt/shared/implicitness";
import * as Lit from "@qtt/shared/literals";
import * as R from "@qtt/shared/rows";

import { Constraint } from "./elaborate";

import * as EB from ".";

export const display = (term: EB.Term): string => {
	return match(term)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			variable.type === "Free" ? variable.name : variable.type === "Meta" ? `?${variable.index}` : `v${variable.index}`,
		)

		.with({ type: "Abs" }, ({ binding, body }) => {
			const b = match(binding)
				.with({ type: "Lambda" }, ({ variable, icit }) => `λ${Icit.display(icit)}${variable}`)
				.with(
					{ type: "Pi" },
					({ icit, variable, annotation, multiplicity }) => `Π(${Icit.display(icit)}${variable}: <${Q.display(multiplicity)}> ${display(annotation)})`,
				)
				.otherwise(() => {
					throw new Error("Display Term Binder: Not implemented");
				});

			const arr = binding.type !== "Let" && binding.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${display(body)}`;
		})
		.with({ type: "App" }, ({ icit, func, arg }) => `${display(func)} ${Icit.display(icit)}${display(arg)}`)
		.with({ type: "Annotation" }, ({ term, ann }) => `${display(term)} : ${display(ann)}`)
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: display,
				var: (v: EB.Variable) => display({ type: "Var", variable: v }),
			})(row),
		)
		.with({ type: "Proj" }, ({ label, term }) => `(${display(term)}).${label}`)
		.with({ type: "Inj" }, ({ label, value, term }) => `{ ${display(term)} | ${label} = ${display(value)} }`)
		.exhaustive();
	//.otherwise(tm => `Display Term ${tm.type}: Not implemented`);
};

export const displayConstraint = (constraint: Constraint): string => {
	if (constraint.type === "assign") {
		return `${NF.display(constraint.left)} ~~ ${NF.display(constraint.right)}`;
	}

	if (constraint.type === "usage") {
		return `${Q.display(constraint.computed)} <= ${Q.display(constraint.expected)}`;
	}

	return "Unknown Constraint";
};

export const displayContext = (context: EB.Context): object => {
	const pretty = {
		env: context.env.map(NF.display),
		types: context.types.map(([name, origin, mv]) => `${name} (${origin}): ${NF.display(mv)}`),
		names: context.names,
		imports: context.imports,
	};
	return pretty;
};
