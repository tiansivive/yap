import { match } from "ts-pattern";

import * as Lit from "@qtt/shared/literals";
import * as Icit from "@qtt/shared/implicitness";

import * as Src from "@qtt/src/index";
import * as R from "@qtt/shared/rows";

export const display = (term: Src.Term): string => {
	return match(term)
		.with({ type: "lit" }, ({ value }) => Lit.display(value))
		.with({ type: "var" }, ({ variable }) => variable.value)
		.with({ type: "hole" }, _ => "?")
		.with({ type: "arrow" }, ({ lhs, rhs, icit }) => {
			return `${Icit.display(icit)}${display(lhs)} ${arr(icit)} ${display(rhs)}`;
		})
		.with({ type: "lambda" }, ({ icit, variable, annotation, body }) => {
			const ann = annotation ? `: ${display(annotation)}` : "";
			return `λ(${Icit.display(icit)}${variable}${ann}) ${arr(icit)} ${display(body)}`;
		})
		.with({ type: "pi" }, ({ icit, variable, annotation, body }) => {
			return `Π(${Icit.display(icit)}${variable}: ${display(annotation)}) ${arr(icit)} ${display(body)}`;
		})
		.with({ type: "application" }, ({ icit, fn, arg }) => {
			return `${display(fn)} ${display(arg)}`;
		})
		.with({ type: "annotation" }, ({ term, ann }) => {
			return `(${display(term)} : ${display(ann)})`;
		})

		.with({ type: "row" }, ({ row }) => {
			return R.display({
				term: display,
				var: (v: Src.Variable) => v.value,
			})(row);
		})

		.otherwise(tm => `Display Term ${tm.type}: Not implemented`);
};

const arr = (icit: string) => (icit === "Implicit" ? "=>" : "->");
