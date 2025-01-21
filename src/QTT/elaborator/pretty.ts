import * as E from "./syntax";

import * as NF from "./normalized";

import { match } from "ts-pattern";
import { displayIcit, displayLit, Multiplicity } from "../shared";
import { Constraint, Context } from "./elaborate";

export const print: {
	(term: E.Term): string;
	(term: NF.ModalValue): string;
} = (tm: E.Term | NF.ModalValue) => {
	if (Array.isArray(tm)) {
		return "<" + displayValue(tm[0]) + "::" + displayMultiplicity(tm[1]) + ">";
	}

	return displayTerm(tm);
};

const displayTerm = (term: E.Term): string => {
	return match(term)
		.with({ type: "Lit" }, ({ value }) => displayLit(value))
		.with({ type: "Var" }, ({ variable }) =>
			variable.type === "Free"
				? variable.name
				: variable.type === "Meta"
					? `?${variable.index}`
					: `v${variable.index}`,
		)

		.with({ type: "Abs" }, ({ binding, body }) => {
			const b = match(binding)
				.with(
					{ type: "Lambda" },
					({ variable, icit }) => `λ${displayIcit(icit)}${variable}`,
				)
				.with(
					{ type: "Pi" },
					({ icit, variable, annotation, multiplicity }) =>
						`Π(${displayIcit(icit)}${variable}: <${displayMultiplicity(multiplicity)}>${print(annotation)})`,
				)
				.otherwise(() => {
					throw new Error("Display Term Binder: Not implemented");
				});

			const arr =
				binding.type !== "Let" && binding.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${print(body)}`;
		})
		.with(
			{ type: "App" },
			({ icit, func, arg }) => `${print(func)} ${print(arg)}`,
		)
		.with(
			{ type: "Annotation" },
			({ term, ann }) => `${print(term)} : ${print(ann)}`,
		)
		.exhaustive();
};

export const displayValue = (value: NF.Value): string => {
	return match(value)
		.with({ type: "Lit" }, ({ value }) => displayLit(value))
		.with({ type: "Var" }, ({ variable }) =>
			variable.type === "Free" ? variable.name : `?${variable.index}`,
		)
		.with({ type: "Neutral" }, ({ value }) => displayValue(value))
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with(
					{ type: "Lambda" },
					({ variable, icit }) => `λ${displayIcit(icit)}${variable}`,
				)
				.with(
					{ type: "Pi" },
					({ icit, variable, annotation }) =>
						`Π(${displayIcit(icit)}${variable}:${print(annotation)})`,
				)
				.exhaustive();

			const arr = binder.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${print(closure.term)}`; // TODO: Print environment
		})
		.with(
			{ type: "App" },
			({ func, arg }) => `${displayValue(func)} ${displayValue(arg)}`,
		)
		.exhaustive();
};

const displayMultiplicity = (multiplicity: Multiplicity): string => {
	return match(multiplicity)
		.with("One", () => "1")
		.with("Zero", () => "0")
		.with("Many", () => "ω")
		.otherwise(() => JSON.stringify(multiplicity));
};

export const displayConstraint = (constraint: Constraint): string => {
	if (constraint.type === "assign") {
		return `${displayValue(constraint.left)}  ~~  ${displayValue(constraint.right)}`;
	}

	if (constraint.type === "usage") {
		return `${displayMultiplicity(constraint.computed)}  <=  ${displayMultiplicity(constraint.expected)}`;
	}

	return "Unknown Constraint";
};

export const displayContext = (context: Context): object => {
	const pretty = {
		env: context.env.map(print),
		types: context.types.map(
			([name, origin, mv]) => `${name} (${origin}): ${print(mv)}`,
		),
		names: context.names,
		imports: context.imports,
	};
	return pretty;
};
