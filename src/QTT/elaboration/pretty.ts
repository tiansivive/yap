import * as NF from "./normalization";

import * as Q from "@qtt/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@qtt/shared/implicitness";
import * as Lit from "@qtt/shared/literals";
import * as R from "@qtt/shared/rows";

import { Constraint } from "./elaborate";

import * as EB from ".";

const display = (term: EB.Term): string => {
	return match(term)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ index }) => `i${index}`)
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Meta" }, ({ val }) => `?${val}`)
				.otherwise(() => "Var Display: Not implemented"),
		)
		.with({ type: "Abs" }, ({ binding, body }) => {
			const b = match(binding)
				.with({ type: "Lambda" }, ({ variable, icit }) => `λ${Icit.display(icit)}${variable}`)
				.with(
					{ type: "Pi" },
					({ icit, variable, annotation, multiplicity }) => `Π(${Icit.display(icit)}${variable}: <${Q.display(multiplicity)}> ${display(annotation)})`,
				)
				.with({ type: "Mu" }, ({ variable, annotation }) => `μ${variable}: ${display(annotation)}`)
				.otherwise(() => {
					throw new Error("Display Term Binder: Not implemented");
				});

			const arr = binding.type !== "Let" && binding.type !== "Mu" && binding.icit === "Implicit" ? "=>" : "->";
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
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
			const scut = display(scrutinee);
			const alts = alternatives.map(Alt.display).join("\n");
			return `match ${scut}\n${alts}`;
		})
		.with({ type: "Block" }, ({ statements, return: ret }) => {
			const stmts = statements.map(Stmt.display).join("; ");
			return `{ ${stmts}; return ${display(ret)}; }`;
		})
		.exhaustive();
	//.otherwise(tm => `Display Term ${tm.type}: Not implemented`);
};

const displayConstraint = (constraint: Constraint): string => {
	if (constraint.type === "assign") {
		return `${NF.display(constraint.left)} ~~ ${NF.display(constraint.right)}`;
	}

	if (constraint.type === "usage") {
		return `${Q.display(constraint.computed)} <= ${Q.display(constraint.expected)}`;
	}

	return "Unknown Constraint";
};

const displayContext = (context: EB.Context): object => {
	const pretty = {
		env: context.env.map(NF.display),
		types: context.types.map(([binder, origin, mv]) => `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${NF.display(mv)}`),
		names: context.names,
		imports: context.imports,
	};
	return pretty;
};

const displayBinder = (binder: EB.Binder["type"]): string => {
	return match(binder)
		.with("Let", () => "def")
		.with("Lambda", () => "λ")
		.with("Pi", () => "Π")
		.with("Mu", () => "μ")
		.otherwise(() => "Binder Display: Not implemented");
};

const Alt = {
	display: (alt: EB.Alternative): string => `| ${Pat.display(alt.pattern)} -> ${display(alt.term)}`,
};

const Pat = {
	display: (pat: EB.Pattern): string => {
		return (
			match(pat)
				.with({ type: "Lit" }, ({ value }) => Lit.display(value))
				.with({ type: "Var" }, ({ value }) => `Imports.${value}`)
				.with({ type: "Binder" }, ({ value }) => value)
				// .with({ type: "Wildcard" }, () => "_")
				.with({ type: "Row" }, ({ row }) =>
					R.display({
						term: Pat.display,
						var: (v: string) => v,
					})(row),
				)
				.with({ type: "Struct" }, ({ row }) => {
					const r = R.display({
						term: Pat.display,
						var: (v: string) => v,
					})(row);
					return `Struct ${r}`;
				})
				.otherwise(() => "Pattern Display: Not implemented")
		);
	},
};

const Stmt = {
	display: (stmt: EB.Statement): string => {
		return match(stmt)
			.with({ type: "Expression" }, ({ value }) => display(value))
			.with({ type: "Let" }, ({ variable, value, annotation }) => `let ${variable}: ${display(annotation)} = ${display(value)}`)
			.otherwise(() => "Statement Display: Not implemented");
	},
};

export const Display = {
	Term: display,
	Constraint: displayConstraint,
	Context: displayContext,
	Alternative: Alt.display,
	Pattern: Pat.display,
	Statement: Stmt.display,
};
