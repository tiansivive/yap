import * as NF from "../normalization";

import * as Q from "@yap/shared/modalities/multiplicity";

import { match } from "ts-pattern";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import * as PP from "@yap/shared/pretty";

import * as Eff from "@yap/utils/effects";

import * as EB from "..";
import * as M from "../shared/effects";
import * as Metas from "../shared/metas";
import { options } from "@yap/shared/config/options";

/** Display's row: the ambient scope and the metacontext, read-only. */
export type Display<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Only<typeof Metas.registry, "Registry.get">, A>;

type Opts = { deBruijn: boolean; printEnv?: boolean };

/*
 * Display's binder descent: v2's name-only entry, through the reader. The
 * pseudo-entry carries just the name display reads; it exists only for the
 * extent of a reader.local and never meets evaluation.
 */
export const bound =
	(variable: string) =>
	(ctx: EB.Context): EB.Context =>
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- name-only display entry, read by nothing but display
		({ ...ctx, env: [{ name: { variable } }, ...ctx.env] }) as EB.Context;

/** An effectful row traversal into a row of finished docs; layout stays R.displayDoc's. */
export const rowDocs = function* <T, V>(
	row: R.Row<T, V>,
	term: (value: T) => Display<PP.Doc>,
	variable: (v: V) => Display<PP.Doc>,
): Display<R.Row<PP.Doc, PP.Doc>> {
	if (row.type === "empty") {
		return row;
	}
	if (row.type === "variable") {
		return R.Constructors.Variable(yield* variable(row.variable));
	}
	return R.Constructors.Extension(row.label, yield* term(row.value), yield* rowDocs(row.row, term, variable));
};

const identityRow = { term: (d: PP.Doc) => d, var: (v: PP.Doc) => v };

const doc = function* (term: EB.Term, opts: Opts = { deBruijn: false, printEnv: false }): Display<PP.Doc> {
	const go = (tm: EB.Term) => doc(tm, opts);

	return yield* match(term)
		.with({ type: "Lit" }, function* ({ value }) {
			return Lit.display(value);
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* ({ index }) {
					const { env } = yield* M.reader.ask();
					const name = env[index]?.name.variable ?? `I${index}`;
					return name + (opts.deBruijn ? `#I${index}` : "");
				})
				.with({ type: "Free" }, function* ({ name }) {
					return name;
				})
				.with({ type: "Foreign" }, function* ({ name }) {
					return `FFI.${name}`;
				})
				.with({ type: "Label" }, function* ({ name }) {
					return `:${name}`;
				})
				.with({ type: "Meta" }, function* ({ val }) {
					const entry = (yield* Metas.registry.get())[val];
					if (entry?.solution) {
						return yield* NF.doc(entry.solution, opts);
					}
					if (options.verbose && entry) {
						return ["(?", `${val}`, " :: ", yield* NF.doc(entry.annotation, opts), ")"] satisfies PP.Doc;
					}
					return `?${val}`;
				})
				.otherwise(function* () {
					return "Var _display: Not implemented";
				});
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, function* ({ binding, body }) {
			if (!options.verbose) {
				return binding.source;
			}
			return PP.group([
				"([μ = ",
				binding.source,
				"](",
				binding.variable,
				": ",
				yield* go(binding.annotation),
				"))",
				" ->",
				PP.nest(2, [PP.line, yield* M.reader.local(bound(binding.variable), doc(body, opts))]),
			]);
		})
		.with({ type: "Abs" }, function* ({ binding, body }) {
			const b: PP.Doc = yield* match(binding)
				.with({ type: "Lambda" }, function* ({ variable, annotation }) {
					return ["λ(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.with({ type: "Sigma" }, function* ({ variable, annotation }) {
					return ["Σ(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.with({ type: "Pi" }, function* ({ variable, annotation }) {
					return ["Π(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.otherwise(() => {
					throw new Error("_display Term Binder: Not implemented");
				});

			const arrow = match(binding)
				.with({ type: "Sigma" }, () => ".")
				.with({ icit: "Implicit" }, () => "=>")
				.otherwise(() => "->");

			const inner = binding.type === "Sigma" ? go(body) : M.reader.local(bound(binding.variable), go(body));

			if (opts.printEnv) {
				return PP.group(["(", b, " ", arrow, PP.nest(2, [PP.line, yield* inner])]);
			}
			return PP.binder(b, arrow, yield* inner);
		})
		.with({ type: "App" }, function* ({ icit, func, arg }) {
			const needsFnParens = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
			const needsArgParens = arg.type === "Abs" || arg.type === "App";
			return PP.app(PP.parensIf(needsFnParens, yield* go(func)), Icit.display(icit), PP.parensIf(needsArgParens, yield* go(arg)));
		})
		.with({ type: "Row" }, function* ({ row }) {
			return R.displayDoc(identityRow)(yield* rowDocs(row, go, (v: EB.Variable) => go(EB.Constructors.Var(v))));
		})
		.with({ type: "Proj" }, function* ({ label, term: tm }) {
			return ["(", yield* go(tm), ").", label] satisfies PP.Doc;
		})
		.with({ type: "Inj" }, function* ({ label, value, term: tm }) {
			return PP.group(["{ ", yield* go(tm), " | ", label, " =", PP.nest(2, [PP.line, yield* go(value)]), " }"]);
		})
		.with({ type: "Match" }, function* ({ scrutinee, alternatives }) {
			const scrut = yield* go(scrutinee);
			const alts = yield* Eff.traverse(alternatives, function* (a) {
				const term = yield* M.reader.local(ctx => a.binders.reduce((acc, [b]) => bound(b)(acc), ctx), doc(a.term, opts));
				return PP.alt(Pat.doc(a.pattern), term);
			});
			return PP.matchDoc(scrut, alts);
		})
		.with({ type: "Block" }, function* ({ statements, return: ret }) {
			const blocks = function* (rest: readonly EB.Statement[], stmtDocs: PP.Doc[]): Display<PP.Doc> {
				if (rest.length === 0) {
					return PP.block(stmtDocs, yield* doc(ret, opts));
				}
				const [stmt, ...tail] = rest;
				const d = yield* Stmt.doc(stmt, opts);
				if (stmt.type === "Let") {
					return yield* M.reader.local(bound(stmt.variable), blocks(tail, [...stmtDocs, d]));
				}
				return yield* blocks(tail, [...stmtDocs, d]);
			};
			return yield* blocks(statements, []);
		})
		.with({ type: "Modal" }, function* ({ term: tm, modalities }) {
			return ["<", Q.display(modalities.quantity), "> ", yield* go(tm), " [| ", yield* go(modalities.liquid), " |]"] satisfies PP.Doc;
		})
		.with({ type: "Reset" }, function* ({ term: tm }) {
			return ["reset |", yield* go(tm), "|"] satisfies PP.Doc;
		})
		.with({ type: "Shift" }, function* ({ body }) {
			return ["shift (", yield* go(body), ")"] satisfies PP.Doc;
		})
		.with({ type: "Bubble" }, function* ({ meta, shift }) {
			return ["bubble#", `${meta}`, " (", yield* go(shift), ")"] satisfies PP.Doc;
		})
		.with({ type: "Ann" }, function* ({ term: tm, ann }) {
			return ["(", yield* go(tm), " : ", yield* go(ann), ")"] satisfies PP.Doc;
		})
		.exhaustive();
};

const display = function* (term: EB.Term, opts: Opts = { deBruijn: false, printEnv: false }): Display<string> {
	return PP.render(yield* doc(term, opts));
};

const displayConstraint = function* (constraint: EB.Constraint, opts = { deBruijn: false }): Display<string> {
	if (constraint.type === "assign") {
		return `${yield* NF.display(constraint.left, opts)} ~~ ${yield* NF.display(constraint.right, opts)}`;
	}

	if (constraint.type === "resolve") {
		return `?${constraint.meta.val} @ ${yield* NF.display(constraint.value, opts)}`;
	}

	return "Unknown Constraint";
};

/** Renders a specific context — its values display under that context's own scope. */
const displayContext = function* (context: EB.Context, opts = { deBruijn: false }): Display<object> {
	const entries = yield* M.reader.local(
		_ => context,
		Eff.traverse(context.env, function* ({ nf, type: [binder, origin, mv], name }) {
			return {
				nf: yield* NF.display(nf, opts),
				type: `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${yield* NF.display(mv, opts)}`,
				name,
			};
		}),
	);

	return { env: entries, imports: context.imports };
};

const displayEnv = (env: EB.Context["env"], _opts = { deBruijn: false }): string => {
	const printed = env.map(({ name }) => name.variable);

	return printed.length > 0 ? `Γ: ${printed.join("; ")}` : "·";
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

const Stmt = {
	doc: function* (stmt: EB.Statement, opts = { deBruijn: false }): Display<PP.Doc> {
		return yield* match(stmt)
			.with({ type: "Expression" }, function* ({ value }) {
				return yield* doc(value, opts);
			})
			.with({ type: "Let" }, function* ({ variable, value, annotation }) {
				return yield* M.reader.local(
					bound(variable),
					(function* (): Display<PP.Doc> {
						return PP.letBinding(variable, yield* NF.doc(annotation, opts), yield* doc(value, opts));
					})(),
				);
			})
			.with({ type: "Using" }, function* ({ value }) {
				return PP.group(["using ", yield* doc(value, opts)]);
			})
			.otherwise(function* () {
				return "Statement Display: Not implemented";
			});
	},
	display: function* (this: void, stmt: EB.Statement, opts = { deBruijn: false }): Display<string> {
		return PP.render(yield* Stmt.doc(stmt, opts));
	},
};

export const Display = {
	Term: display,
	Constraint: displayConstraint,
	Context: displayContext,
	Env: displayEnv,
	Alternative: function* (alt: EB.Alternative, opts = { deBruijn: false }): Display<string> {
		const term = yield* M.reader.local(ctx => alt.binders.reduce((acc, [b]) => bound(b)(acc), ctx), doc(alt.term, opts));

		return PP.render(PP.alt(Pat.doc(alt.pattern), term));
	},
	Pattern: Pat.display,
	Statement: Stmt.display,
	doc,
};
