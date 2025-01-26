import { match } from "ts-pattern";
import * as Src from "./terms";

import { displayIcit, displayLit } from "../shared";

export const print = (term: Src.Term): string => {
	return match(term)
		.with({ type: "lit" }, ({ value }) => displayLit(value))
		.with({ type: "var" }, ({ variable }) => variable.value)
		.with({ type: "arrow" }, ({ lhs, rhs, icit }) => {
			return `${displayIcit(icit)}${print(lhs)} ${arr(icit)} ${print(rhs)}`;
		})
		.with({ type: "lambda" }, ({ icit, variable, annotation, body }) => {
			const ann = annotation ? `: ${print(annotation)}` : "";
			return `λ(${displayIcit(icit)}${variable}${ann}) ${arr(icit)} ${print(body)}`;
		})
		.with({ type: "pi" }, ({ icit, variable, annotation, body }) => {
			return `Π(${displayIcit(icit)}${variable}: ${print(annotation)}) ${arr(icit)} ${print(body)}`;
		})
		.with({ type: "application" }, ({ icit, fn, arg }) => {
			return `${print(fn)} ${print(arg)}`;
		})
		.with({ type: "annotation" }, ({ term, ann }) => {
			return `(${print(term)} : ${print(ann)})`;
		})
		.with({ type: "hole" }, _ => "?")
		.otherwise(() => {
			throw new Error("Display Term Binder: Not implemented");
		});
};

const arr = (icit: string) => (icit === "Implicit" ? "=>" : "->");
