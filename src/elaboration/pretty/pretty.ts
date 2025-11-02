import * as NF from "../normalization";

import * as Q from "@yap/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";

import * as EB from "..";
import { options } from "@yap/shared/config/options";

import * as Null from "@yap/utils";

const display = (term: EB.Term, ctx: DisplayContext, opts: { deBruijn: boolean; printEnv?: boolean } = { deBruijn: false, printEnv: false }): string => {
	const bind = (name: string) => {
		return { ...ctx, env: [{ name: { variable: name } }, ...ctx.env] } as DisplayContext;
	};
	const _display = (term: EB.Term): string => {
		return (
			match(term)
				.with({ type: "Lit" }, ({ value }) => Lit.display(value))
				.with({ type: "Var" }, ({ variable }) =>
					match(variable)
						.with({ type: "Bound" }, ({ index }) => {
							const name = ctx.env[index]?.name.variable ?? `I${index}`;
							return name + (opts.deBruijn ? `#I${index}` : "");
						})
						.with({ type: "Free" }, ({ name }) => name)
						.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
						.with({ type: "Label" }, ({ name }) => `:${name}`)
						.with({ type: "Meta" }, ({ val }) => {
							if (ctx.zonker[val]) {
								return NF.display(ctx.zonker[val], ctx, opts);
							}
							const { ann } = ctx.metas[val];
							return options.verbose ? `(?${val} :: ${NF.display(ann, ctx, opts)})` : `?${val}`;
						})
						.otherwise(() => "Var _display: Not implemented"),
				)
				.with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) => {
					if (!options.verbose) {
						return binding.source;
					}

					return `([μ = ${binding.source}](${binding.variable}: ${_display(binding.annotation)})) -> ${display(body, bind(binding.variable), opts)}`;
				})
				.with({ type: "Abs" }, ({ binding, body }) => {
					const b = match(binding)
						.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
						.with({ type: "Pi" }, ({ variable, annotation }) => `Π(${variable}: ${_display(annotation)})`)
						.otherwise(() => {
							throw new Error("_display Term Binder: Not implemented");
						});

					const arr = binding.type !== "Let" && binding.type !== "Mu" && binding.icit === "Implicit" ? "=>" : "->";

					const xtended = bind(binding.variable);
					const printedEnv = xtended.env
						.map(({ nf, name }) => {
							if (nf) {
								return `${name.variable} = ${NF.display(nf, xtended, opts)}`;
							}
							return name.variable;
						})
						.join("; ");

					//TODO:QUESTION: should we print the environment here?
					if (opts.printEnv) {
						return `(${b} ${arr} ${display(body, xtended, opts)} -| Γ = ${printedEnv})`;
					}
					return `${b} ${arr} ${display(body, xtended, opts)}`;
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
					const alts = alternatives.map(a => Alt.display(a, ctx, opts)).join("\n");
					return `match ${scut}\n${alts}`;
				})
				.with({ type: "Block" }, ({ statements, return: ret }) => {
					const stmts = statements.map(s => Stmt.display(s, ctx, opts)).join("; ");
					return `{ ${stmts}; return ${_display(ret)}; }`;
				})
				.with({ type: "Modal" }, ({ term, modalities }) => {
					return `<${Q.display(modalities.quantity)}> ${_display(term)} [| ${_display(modalities.liquid)} |]`;
				})
				//.otherwise(tm => `_display Term ${tm.type}: Not implemented`);
				.exhaustive()
		);
	};
	return _display(term);
};

const displayConstraint = (constraint: EB.Constraint, ctx: Pick<EB.Context, "zonker" | "metas" | "env">, opts = { deBruijn: false }): string => {
	if (constraint.type === "assign") {
		return `${NF.display(constraint.left, ctx, opts)} ~~ ${NF.display(constraint.right, ctx, opts)}`;
	}

	if (constraint.type === "usage") {
		return `${Q.display(constraint.computed)} <= ${Q.display(constraint.expected)}`;
	}

	// if (constraint.type === "resolve") {
	// 	return `?${constraint.meta.val}\n@ ${NF.display(constraint.annotation, zonker, metas)}`;
	// }

	return "Unknown Constraint";
};

const displayContext = (context: EB.Context, opts = { deBruijn: false }): object => {
	const pretty = {
		env: context.env.map(({ nf, type: [binder, origin, mv], name }) => ({
			nf: NF.display(nf, context, opts),
			type: `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${NF.display(mv, context, opts)}`,
			name,
		})),
		imports: context.imports,
	};
	return pretty;
};

const displayEnv = (ctx: EB.Context, opts = { deBruijn: false }): string => {
	const printedEnv = ctx.env
		.map(({ nf, name }) => {
			if (nf) {
				return `${name.variable} = ${NF.display(nf, ctx, opts)}`;
			}
			return name.variable;
		})
		.slice(0); // remove the bound variable itself

	return printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";
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
	display: (alt: EB.Alternative, ctx: Pick<EB.Context, "zonker" | "metas" | "env">, opts = { deBruijn: false }): string => {
		const xtended = alt.binders.reduce((acc, [b]) => ({ ...acc, env: [{ name: { variable: b } }, ...acc.env] }) as typeof ctx, ctx);
		return `| ${Pat.display(alt.pattern)} -> ${display(alt.term, xtended, opts)}`;
	},
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
	display: (stmt: EB.Statement, ctx: Pick<EB.Context, "zonker" | "metas" | "env">, opts = { deBruijn: false }): string => {
		return match(stmt)
			.with({ type: "Expression" }, ({ value }) => display(value, ctx, opts))
			.with({ type: "Let" }, ({ variable, value, annotation }) => `let ${variable}\n\t: ${NF.display(annotation, ctx, opts)}\n\t= ${display(value, ctx, opts)}`)
			.otherwise(() => "Statement Display: Not implemented");
	},
};

export const Display = {
	Term: display,
	Constraint: displayConstraint,
	Context: displayContext,
	Env: displayEnv,
	Alternative: Alt.display,
	Pattern: Pat.display,
	Statement: Stmt.display,
};

export type DisplayContext = Pick<EB.Context, "env" | "zonker" | "metas"> & { ambient?: EB.Context["env"] };
