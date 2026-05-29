import * as NF from "../normalization";

import * as Q from "@yap/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import * as PP from "@yap/shared/pretty";

import * as EB from "..";
import { options } from "@yap/shared/config/options";

import * as Null from "@yap/utils";

import * as V2 from "@yap/elaboration/shared/monad.v2";

const doc = (term: EB.Term, ctx: DisplayContext, opts: { deBruijn: boolean; printEnv?: boolean } = { deBruijn: false, printEnv: false }): PP.Doc => {
	const go = (term: EB.Term): PP.Doc =>
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
						if (ctx.skolems && ctx.skolems[val]) {
							return go(ctx.skolems[val]);
						}

						if (ctx.zonker[val]) {
							return NF.doc(ctx.zonker[val], ctx, opts);
						}
						const { ann } = ctx.metas[val];
						return options.verbose ? ["(?", `${val}`, " :: ", NF.doc(ann, ctx, opts), ")"] : `?${val}`;
					})
					.otherwise(() => "Var _display: Not implemented"),
			)
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) => {
				if (!options.verbose) {
					return binding.source;
				}
				return PP.group([
					"([μ = ",
					binding.source,
					"](",
					binding.variable,
					": ",
					go(binding.annotation),
					"))",
					" ->",
					PP.nest(2, [PP.line, doc(body, bind(binding.variable, ctx), opts)]),
				]);
			})
			.with({ type: "Abs" }, ({ binding, body }) => {
				const b: PP.Doc = match(binding)
					.with({ type: "Lambda" }, ({ variable, annotation }) => ["λ(", variable, ": ", go(annotation), ")"])
					.with({ type: "Sigma" }, ({ variable }) => ["Σ(", variable, ": ", go(binding.annotation), ")"])
					.with({ type: "Pi" }, ({ variable, annotation }) => ["Π(", variable, ": ", go(annotation), ")"])
					.otherwise(() => {
						throw new Error("_display Term Binder: Not implemented");
					});

				const arrow = match(binding)
					.with({ type: "Sigma" }, () => ".")
					.with({ icit: "Implicit" }, () => "=>")
					.otherwise(() => "->");

				const xtended = binding.type === "Sigma" ? ctx : bind(binding.variable, ctx);

				if (opts.printEnv) {
					return PP.group(["(", b, " ", arrow, PP.nest(2, [PP.line, doc(body, xtended, opts)])]);
				}
				return PP.binder(b, arrow, doc(body, xtended, opts));
			})
			.with({ type: "App" }, ({ icit, func, arg }) => {
				const needsFnParens = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
				const needsArgParens = arg.type === "Abs" || arg.type === "App";
				return PP.app(PP.parensIf(needsFnParens, go(func)), Icit.display(icit), PP.parensIf(needsArgParens, go(arg)));
			})
			.with({ type: "Row" }, ({ row }) =>
				R.displayDoc({
					term: go,
					var: (v: EB.Variable) => go(EB.Constructors.Var(v)),
				})(row),
			)
			.with({ type: "Proj" }, ({ label, term: tm }) => ["(", go(tm), ").", label])
			.with({ type: "Inj" }, ({ label, value, term: tm }) => PP.group(["{ ", go(tm), " | ", label, " =", PP.nest(2, [PP.line, go(value)]), " }"]))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
				PP.matchDoc(
					go(scrutinee),
					alternatives.map(a => {
						const xtended = a.binders.reduce((acc, [b]) => ({ ...acc, env: [{ name: { variable: b } }, ...acc.env] }) as typeof ctx, ctx);
						return PP.alt(Pat.doc(a.pattern), doc(a.term, xtended, opts));
					}),
				),
			)
			.with({ type: "Block" }, ({ statements, return: ret }) => {
				const { stmtDocs, next } = statements.reduce<{ stmtDocs: PP.Doc[]; next: DisplayContext }>(
					({ stmtDocs, next }, stmt) => {
						const d = Stmt.doc(stmt, next, opts);
						const xtended = stmt.type === "Let" ? bind(stmt.variable, next) : next;
						return { stmtDocs: [...stmtDocs, d], next: xtended };
					},
					{ stmtDocs: [], next: ctx },
				);
				return PP.block(stmtDocs, doc(ret, next, opts));
			})
			.with({ type: "Modal" }, ({ term: tm, modalities }) => ["<", Q.display(modalities.quantity), "> ", go(tm), " [| ", go(modalities.liquid), " |]"])
			.with({ type: "Reset" }, ({ term: tm }) => ["reset |", go(tm), "|"])
			.with({ type: "Shift" }, ({ body }) => ["shift (", go(body), ")"])
			.with({ type: "Ann" }, ({ term, ann }) => ["(", go(term), " : ", go(ann), ")"])
			.exhaustive();

	return go(term);
};

const display = (term: EB.Term, ctx: DisplayContext, opts: { deBruijn: boolean; printEnv?: boolean } = { deBruijn: false, printEnv: false }): string =>
	PP.render(doc(term, ctx, opts));

const displayConstraint = (constraint: EB.Constraint, ctx: DisplayContext, opts = { deBruijn: false }): string => {
	if (constraint.type === "assign") {
		return `${NF.display(constraint.left, ctx, opts)} ~~ ${NF.display(constraint.right, ctx, opts)}`;
	}

	if (constraint.type === "resolve") {
		return `?${constraint.meta.val} @ ${NF.display(constraint.value, ctx, opts)}`;
	}

	return "Unknown Constraint";
};

const displayContext = (context: EB.Context, resolutions: EB.Resolutions, opts = { deBruijn: false }): object => {
	const pretty = {
		env: context.env.map(({ nf, type: [binder, origin, mv], name }) => ({
			nf: NF.display(nf, { ...context, resolutions }, opts),
			type: `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${NF.display(mv, { ...context, resolutions }, opts)}`,
			name,
		})),
		imports: context.imports,
	};
	return pretty;
};

const displayEnv = (ctx: EB.Context, opts = { deBruijn: false }): string => {
	const printedEnv = ctx.env.map(({ name }) => name.variable).slice(0);

	return printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";
};

const displayBinder = (binder: EB.Binder["type"]): string =>
	match(binder)
		.with("Let", () => "def")
		.with("Lambda", () => "λ")
		.with("Pi", () => "Π")
		.with("Mu", () => "μ")
		.otherwise(() => "Binder Display: Not implemented");

const Pat = {
	doc: (pat: EB.Pattern): PP.Doc =>
		match(pat)
			.with({ type: "Lit" }, ({ value }) => Lit.display(value))
			.with({ type: "Var" }, ({ value }) => `Imports.${value}`)
			.with({ type: "Binder" }, ({ value }) => value)
			.with({ type: "Row" }, ({ row }) => R.displayDoc({ term: Pat.doc, var: (v: string) => v })(row))
			.with({ type: "Struct" }, ({ row }) => ["Struct ", R.displayDoc({ term: Pat.doc, var: (v: string) => v })(row)])
			.with({ type: "Variant" }, ({ row }) => ["Variant ", R.displayDoc({ term: Pat.doc, var: (v: string) => v })(row)])
			.with({ type: "List" }, ({ patterns, rest }) => {
				const r = rest ? [" | ", rest] : "";
				return PP.list([...patterns.map(Pat.doc), r]);
			})
			.with({ type: "Wildcard" }, () => "_")
			.otherwise(() => "Pattern Display: Not implemented"),
	display: (pat: EB.Pattern): string => PP.render(Pat.doc(pat)),
};

const bind = (name: string, ctx: DisplayContext) => ({ ...ctx, env: [{ name: { variable: name } }, ...ctx.env] }) as DisplayContext;

const Stmt = {
	doc: (stmt: EB.Statement, ctx: DisplayContext, opts = { deBruijn: false }): PP.Doc =>
		match(stmt)
			.with({ type: "Expression" }, ({ value }) => doc(value, ctx, opts))
			.with({ type: "Let" }, ({ variable, value, annotation }) =>
				PP.letBinding(variable, NF.doc(annotation, bind(variable, ctx), opts), doc(value, bind(variable, ctx), opts)),
			)
			.otherwise(() => "Statement Display: Not implemented"),
	display: (stmt: EB.Statement, ctx: DisplayContext, opts = { deBruijn: false }): string => PP.render(Stmt.doc(stmt, ctx, opts)),
};

export const Display = {
	Term: display,
	Constraint: displayConstraint,
	Context: displayContext,
	Env: displayEnv,
	Alternative: (alt: EB.Alternative, ctx: DisplayContext, opts = { deBruijn: false }): string => {
		const xtended = alt.binders.reduce((acc, [b]) => ({ ...acc, env: [{ name: { variable: b } }, ...acc.env] }) as typeof ctx, ctx);
		return PP.render(PP.alt(Pat.doc(alt.pattern), doc(alt.term, xtended, opts)));
	},
	Pattern: Pat.display,
	Statement: Stmt.display,
	doc,
};

export type DisplayContext = Pick<EB.Context, "env" | "zonker" | "metas"> & { resolutions?: EB.Resolutions; skolems?: V2.MutState["skolems"] };
