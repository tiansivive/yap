import * as E from "./syntax";

import * as NF from "./normalized";

import { match } from "ts-pattern";
import { displayIcit, displayLit } from "../shared";

export const print: {
	(term: E.Term): string;
	(term: NF.ModalValue): string;
} = (tm: E.Term | NF.ModalValue) => {
	if (Array.isArray(tm)) {
		return displayValue(tm[0]);
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
					({ icit, variable, annotation }) =>
						`Π(${displayIcit(icit)}${variable}: ${print(annotation)})`,
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

const displayValue = (value: NF.Value): string => {
	return match(value)
		.with({ type: "Lit" }, ({ value }) => displayLit(value))
		.with({ type: "Neutral" }, ({ variable }) =>
			variable.type === "Free" ? variable.name : `?${variable.index}`,
		)
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
