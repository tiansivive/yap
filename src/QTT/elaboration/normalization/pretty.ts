import { match } from "ts-pattern";
import * as NF from "./index";

import * as Lit from "@qtt/shared/literals";
import * as Icit from "@qtt/shared/implicitness";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as EB from "@qtt/elaboration";

export const display = (value: NF.Value | NF.ModalValue): string => {
	if (Array.isArray(value)) {
		const [nf, q] = value;
		return `<${Q.display(q)}> ${display(nf)}`;
	}
	return match(value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) => (variable.type === "Free" ? variable.name : `?${variable.index}`))
		.with({ type: "Neutral" }, ({ value }) => display(value))
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with({ type: "Lambda" }, ({ variable, icit }) => `λ${Icit.display(icit)}${variable}`)
				.with({ type: "Pi" }, ({ icit, variable, annotation }) => `Π(${Icit.display(icit)}${variable}:${display(annotation)})`)
				.exhaustive();

			const arr = binder.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${EB.display(closure.term)}`; // TODO: Print environment
		})
		.with({ type: "App" }, ({ func, arg }) => `${display(func)} ${display(arg)}`)
		.with({ type: "Row" }, ({ row }) => {
			const displayR = (row: NF.Row): string => {
				if (row.type === "Empty") {
					return "";
				}

				if (row.type === "Extension") {
					return `${row.label} : ${display(row.value)}, ${displayR(row.row)}`;
				}

				return display({ type: "Var", variable: row.variable });
			};

			return `{ ${displayR(row)} }`;
		})
		.exhaustive();
};
