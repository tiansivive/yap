import * as NF from "../normalization";

import * as Q from "@yap/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";

import * as EB from "..";
import { options } from "@yap/shared/config/options";

const display = (term: EB.Term, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	const _display = (term: EB.Term): string => {
		return (
			match(term)
				.with({ type: "Lit" }, ({ value }) => Lit.display(value))
				.with({ type: "Var" }, ({ variable }) =>
					match(variable)
						.with({ type: "Bound" }, ({ index }) => `I${index}`)
						.with({ type: "Free" }, ({ name }) => name)
						.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
						.with({ type: "Label" }, ({ name }) => `:${name}`)
						.with({ type: "Meta" }, ({ val }) => {
							if (zonker[val]) {
								return NF.display(zonker[val], zonker, metas);
							}
							const { ann } = metas[val];
							return options.verbose ? `(?${val} :: ${NF.display(ann, zonker, metas)})` : `?${val}`;
						})
						.otherwise(() => "Var _display: Not implemented"),
				)
				.with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) => {
					if (!options.verbose) {
						return binding.source;
					}

					return `([μ = ${binding.source}](${binding.variable}: ${_display(binding.annotation)})) -> ${_display(body)}`;
				})
				.with({ type: "Abs" }, ({ binding, body }) => {
					const b = match(binding)
						.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
						.with({ type: "Pi" }, ({ variable, annotation, modalities }) => `Π(<${Q.display(modalities.quantity)}> ${variable}: ${_display(annotation)})`)
						//.with({ type: "Mu" }, ({ variable, annotation }) => `μ(${variable}: ${_display(annotation)})`)
						.otherwise(() => {
							throw new Error("_display Term Binder: Not implemented");
						});

					const arr = binding.type !== "Let" && binding.type !== "Mu" && binding.icit === "Implicit" ? "=>" : "->";
					return `${b} ${arr} ${_display(body)}`;
				})
				.with({ type: "App" }, ({ icit, func, arg }) => {
					const f = _display(func);
					const a = _display(arg);

					const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
					const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;

					return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
				})

				//.with({ type: "Annotation" }, ({ term, ann }) => `${_display(term)} : ${_display(ann)}`)
				.with({ type: "Row" }, ({ row }) =>
					R.display({
						term: _display,
						var: (v: EB.Variable) => _display(EB.Constructors.Var(v)),
					})(row),
				)
				.with({ type: "Proj" }, ({ label, term }) => `(${_display(term)}).${label}`)
				.with({ type: "Inj" }, ({ label, value, term }) => `{ ${_display(term)} | ${label} = ${_display(value)} }`)
				.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
					const scut = _display(scrutinee);
					const alts = alternatives.map(a => Alt.display(a, zonker, metas)).join("\n");
					return `match ${scut}\n${alts}`;
				})
				.with({ type: "Block" }, ({ statements, return: ret }) => {
					const stmts = statements.map(s => Stmt.display(s, zonker, metas)).join("; ");
					return `{ ${stmts}; return ${_display(ret)}; }`;
				})
				.with({ type: "Modal" }, ({ term, modalities }) => {
					return `<${Q.display(modalities.quantity)}> ${_display(term)} < ${NF.display(modalities.liquid, zonker, metas)} >`;
				})
				//.otherwise(tm => `_display Term ${tm.type}: Not implemented`);
				.exhaustive()
		);
	};
	return _display(term);
};

const displayConstraint = (constraint: EB.Constraint, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	if (constraint.type === "assign") {
		return `${NF.display(constraint.left, zonker, metas)} ~~ ${NF.display(constraint.right, zonker, metas)}`;
	}

	if (constraint.type === "usage") {
		return `${Q.display(constraint.computed)} <= ${Q.display(constraint.expected)}`;
	}

	// if (constraint.type === "resolve") {
	// 	return `?${constraint.meta.val}\n@ ${NF.display(constraint.annotation, zonker, metas)}`;
	// }

	return "Unknown Constraint";
};

const displayContext = (context: EB.Context): object => {
	const pretty = {
		env: context.env.map(({ nf, type: [binder, origin, mv], name }) => ({
			nf: NF.display(nf, context.zonker, context.metas),
			type: `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${NF.display(mv, context.zonker, context.metas)}`,
			name,
		})),
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
	display: (alt: EB.Alternative, zonker: EB.Zonker, metas: EB.Context["metas"]): string =>
		`| ${Pat.display(alt.pattern)} -> ${display(alt.term, zonker, metas)}`,
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
				.with({ type: "Variant" }, ({ row }) => {
					const r = R.display({
						term: Pat.display,
						var: (v: string) => v,
					})(row);
					return `Variant ${r}`;
				})
				.with({ type: "List" }, ({ patterns, rest }) => {
					const pats = patterns.map(Pat.display).join(", ");
					const r = rest ? ` | ${rest}` : "";
					return `[ ${pats}${r} ]`;
				})
				.with({ type: "Wildcard" }, () => "_")
				.otherwise(() => "Pattern Display: Not implemented")
		);
	},
};

const Stmt = {
	display: (stmt: EB.Statement, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
		return match(stmt)
			.with({ type: "Expression" }, ({ value }) => display(value, zonker, metas))
			.with(
				{ type: "Let" },
				({ variable, value, annotation }) => `let ${variable}\n\t: ${display(annotation, zonker, metas)}\n\t= ${display(value, zonker, metas)}`,
			)
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
