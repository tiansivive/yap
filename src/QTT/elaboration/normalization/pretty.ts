import { match } from "ts-pattern";
import * as NF from "./index";

import * as Lit from "@qtt/shared/literals";
import * as Icit from "@qtt/shared/implicitness";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as R from "@qtt/shared/rows";

import * as EB from "@qtt/elaboration";

// TODO:  add environment to properly display variables
export const display = (value: NF.Value | NF.ModalValue): string => {
	if (Array.isArray(value)) {
		const [nf, q] = value;
		return `<${Q.display(q)}> ${display(nf)}`;
	}
	return match(value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => `l${lvl}`)
				.with({ type: "Meta" }, ({ val }) => `?${val}`)
				.with({ type: "Free" }, ({ name }) => name)
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value }) => display(value))
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with({ type: "Lambda" }, ({ variable, icit }) => `λ${Icit.display(icit)}${variable}`)
				.with({ type: "Pi" }, ({ icit, variable, annotation: [ty, m] }) => `Π(<${Q.display(m)}> ${Icit.display(icit)}${variable}: ${display(ty)})`)
				.with({ type: "Mu" }, ({ variable, annotation: [ty, m] }) => `μ(<${Q.display(m)}> ${variable}: ${display(ty)})`)
				.exhaustive();

			const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${EB.Display.Term(closure.term)}`; // TODO: Print environment
		})
		.with({ type: "App" }, ({ func, arg }) => {
			const f = display(func);

			if (func.type !== "Var" && func.type !== "Lit") {
				return `(${f}) ${display(arg)}`;
			}
			return `${f} ${display(arg)}`;
		})
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: display,
				var: (v: NF.Variable) => display({ type: "Var", variable: v }),
			})(row),
		)
		.exhaustive();
};
