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
		.with({ type: "struct" }, ({ row }) => {
			const r = R.display({
				term: display,
				var: (v: Src.Variable) => v.value,
			})(row);
			return `struct ${r}`;
		})
		.with({ type: "projection" }, ({ term, label }) => {
			return `(${display(term)}).${label}`;
		})
		.with({ type: "injection" }, ({ label, value, term }) => {
			return `{ ${display(term)} | ${label} = ${display(value)} }`;
		})
		.with({ type: "match" }, ({ scrutinee, alternatives }) => {
			const scut = display(scrutinee);
			const alts = alternatives.map(Alt.display).join("\n");
			return `match ${scut}\n${alts}`;
		})

		.otherwise(tm => `Display Term ${tm.type}: Not implemented`);
};

const arr = (icit: string) => (icit === "Implicit" ? "=>" : "->");

export const Alt = {
	display: (alt: Src.Alternative): string => `| ${Pat.display(alt.pattern)} -> ${display(alt.term)}`,
};

export const Pat = {
	display: (pat: Src.Pattern): string => {
		return (
			match(pat)
				.with({ type: "lit" }, ({ value }) => Lit.display(value))
				.with({ type: "var" }, ({ value }) => value.value)
				// .with({ type: "Wildcard" }, () => "_")
				.with({ type: "row" }, ({ row }) =>
					R.display({
						term: Pat.display,
						var: (v: Src.Variable) => v.value,
					})(row),
				)
				.with({ type: "struct" }, ({ row }) => {
					const r = R.display({
						term: Pat.display,
						var: (v: Src.Variable) => v.value,
					})(row);
					return `Struct ${r}`;
				})
				.otherwise(() => "Pattern Display: Not implemented")
		);
	},
};
