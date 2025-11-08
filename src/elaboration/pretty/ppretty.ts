import { format, Options, Plugin, doc as PrettierDoc } from "prettier";
import * as EB from "..";
import * as NF from "../normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { match } from "ts-pattern";
import { options } from "@yap/shared/config/options";

export type DisplayContext = Pick<EB.Context, "env" | "zonker" | "metas"> & { ambient?: EB.Context["env"] };

// Small helpers from Prettier's doc builders
const b = PrettierDoc.builders;

// Public API: pretty-print a Term using Prettier's layout engine
export async function Term(
	term: EB.Term,
	ctx: DisplayContext,
	opts: { deBruijn: boolean; printEnv?: boolean } = { deBruijn: false, printEnv: false },
): Promise<string> {
	const plugin = makePlugin(term, ctx, opts);

	const out = await format("dummy", {
		parser: "yap-internal",
		plugins: [plugin],
		printWidth: 100,
		tabWidth: 2,
	} as any);
	return out.trimEnd();
}

// Optional exports for patterns/alternatives/statements if needed later
export async function Alternative(alt: EB.Alternative, ctx: DisplayContext, opts: { deBruijn: boolean } = { deBruijn: false }): Promise<string> {
	const fakeScrut: EB.Term = EB.Constructors.Match(EB.Constructors.Var({ type: "Free", name: "_" }), [alt]);
	const txt = await Term(fakeScrut, ctx, opts as any);
	// Extract only the first alternative line
	const lines = txt.split("\n");
	const bar = lines.find(l => l.trimStart().startsWith("| ")) ?? lines[1] ?? lines[0];
	return bar.trimEnd();
}

export async function Pattern(pat: EB.Pattern): Promise<string> {
	// Use the string-based row helper for now to avoid duplicating logic
	return Pat_toString(pat);
}

// ----------------- Internal: Prettier plugin + printer -----------------

function makePlugin(term: EB.Term, ctx: DisplayContext, opts: { deBruijn: boolean; printEnv?: boolean }): Plugin {
	return {
		languages: [{ name: "Yap", parsers: ["yap-internal"] }],
		parsers: {
			"yap-internal": {
				parse(text: string, opts: any) {
					return term;
				},
				astFormat: "yap-ast",
				locEnd: () => 0,
				locStart: () => 0,
			},
		},
		printers: {
			"yap-ast": {
				print(path: any, opts: any) {
					const node = path.getValue() as EB.Term;
					return toDoc(node, ctx, opts);
				},
			},
		},
	};
}

export function toDoc(term: EB.Term, ctx: DisplayContext, opts: { deBruijn: boolean; printEnv?: boolean }): any /* Doc */ {
	const _toDoc = (t: EB.Term): any =>
		match(t)
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
							return NF.PPretty.toDoc(ctx.zonker[val], ctx, opts);
						}
						const { ann } = ctx.metas[val];
						return options.verbose ? `(?${val} :: ${NF.PPretty.toDoc(ann, ctx, opts)})` : `?${val}`;
					})
					.otherwise(() => "Var _display: Not implemented"),
			)
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) => {
				if (!options.verbose) {
					return binding.source;
				}
				return b.group([
					b.group(["([μ = ", binding.source, "](", binding.variable, ": ", _toDoc(binding.annotation), "))"]),
					" -> ",
					withBound(binding.variable, ctx, () => _toDoc(body)),
				]);
			})
			.with({ type: "Abs" }, ({ binding, body }) => {
				const binderHead = match(binding)
					.with({ type: "Lambda" }, ({ variable }) => ["λ", variable] as any)
					.with({ type: "Pi" }, ({ variable, annotation }) => ["Π(", variable, ": ", _toDoc(annotation), ")"] as any)
					.otherwise(() => {
						throw new Error("ppretty: Term Binder not implemented");
					});
				const arr = binding.type !== "Let" && binding.type !== "Mu" && binding.icit === "Implicit" ? " => " : " -> ";
				return b.group([b.group(binderHead), arr, withBound(binding.variable, ctx, () => _toDoc(body))]);
			})
			.with({ type: "App" }, ({ icit, func, arg }) => {
				const f = _toDoc(func);
				const a = _toDoc(arg);
				const needsParenFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
				const needsParenArg = arg.type === "Abs" || arg.type === "App";
				return b.group([needsParenFn ? ["(", f, ")"] : f, " ", Icit.display(icit), needsParenArg ? ["(", a, ")"] : a]);
			})
			.with({ type: "Row" }, ({ row }) =>
				R.display({ term: (x: EB.Term) => toStringQuick(_toDoc(x)), var: (v: EB.Variable) => toStringQuick(_toDoc(EB.Constructors.Var(v))) })(row),
			)
			.with({ type: "Proj" }, ({ label, term }) => b.group(["(", _toDoc(term), ")", ".", label]))
			.with({ type: "Inj" }, ({ label, value, term }) => b.group(["{ ", _toDoc(term), " | ", label, " = ", _toDoc(value), " }"]))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
				const scut = _toDoc(scrutinee);
				const alts = alternatives.map(a => Alt_toDoc(a, ctx, opts));
				return b.group(["match ", scut, b.indent([b.hardline, joinLines(alts)])]);
			})
			.with({ type: "Block" }, ({ statements, return: ret }) => {
				// Build statements with proper context threading
				const parts: any[] = [];
				let nextCtx = ctx;
				for (const stmt of statements) {
					const d = Stmt_toDoc(stmt, nextCtx, opts);
					parts.push(d, ";", b.hardline);
					if (stmt.type === "Let") {
						nextCtx = bind(stmt.variable, nextCtx);
					}
				}
				const retDoc = toDoc(ret, nextCtx, opts);
				return b.group(["{", b.indent([b.hardline, ...parts, "return ", retDoc, ";"]), b.hardline, "}"]);
			})
			.with({ type: "Modal" }, ({ term, modalities }) =>
				b.group(["<", Q.display(modalities.quantity), "> ", _toDoc(term), " [| ", _toDoc(modalities.liquid), " |]"]),
			)
			.exhaustive();

	return _toDoc(term);
}

// ----------------- Helpers for Alternatives, Patterns, Statements -----------------

function Alt_toDoc(alt: EB.Alternative, ctx: DisplayContext, opts: { deBruijn: boolean }): any {
	const xtended = alt.binders.reduce((acc, [b]) => ({ ...acc, env: [{ name: { variable: b } }, ...acc.env] }) as typeof ctx, ctx);
	return b.group(["| ", Pat_toString(alt.pattern), " -> ", toDoc(alt.term, xtended, opts as any)]);
}

function Pat_toString(pat: EB.Pattern): string {
	return match(pat)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ value }) => `Imports.${value}`)
		.with({ type: "Binder" }, ({ value }) => value)
		.with({ type: "Row" }, ({ row }) => R.display({ term: Pat_toString, var: (v: string) => v })(row))
		.with({ type: "Struct" }, ({ row }) => {
			const r = R.display({ term: Pat_toString, var: (v: string) => v })(row);
			return `Struct ${r}`;
		})
		.with({ type: "Variant" }, ({ row }) => {
			const r = R.display({ term: Pat_toString, var: (v: string) => v })(row);
			return `Variant ${r}`;
		})
		.with({ type: "List" }, ({ patterns, rest }) => {
			const pats = patterns.map(Pat_toString).join(", ");
			const r = rest ? ` | ${rest}` : "";
			return `[ ${pats}${r} ]`;
		})
		.with({ type: "Wildcard" }, () => "_")
		.otherwise(() => "Pattern Display: Not implemented");
}

function Stmt_toDoc(stmt: EB.Statement, ctx: DisplayContext, opts: { deBruijn: boolean }): any {
	return match(stmt)
		.with({ type: "Expression" }, ({ value }) => toDoc(value, ctx, opts as any))
		.with({ type: "Let" }, ({ variable, value, annotation }) =>
			b.group([
				"let ",
				variable,
				b.indent([b.hardline, ": ", NF.PPretty.toDoc(annotation, ctx, opts as any)]),
				b.indent([b.hardline, "= ", withBound(variable, ctx, () => toDoc(value, ctx, opts as any))]),
			]),
		)
		.otherwise(() => "Statement Display: Not implemented");
}

// ----------------- Small utilities -----------------

function bind(name: string, ctx: DisplayContext): DisplayContext {
	return { ...ctx, env: [{ name: { variable: name } }, ...ctx.env] } as DisplayContext;
}

function withBound<T>(name: string, ctx: DisplayContext, k: () => T): T {
	const _ = bind(name, ctx);
	return k();
}

function joinLines(docs: any[]): any {
	if (docs.length === 0) {
		return "";
	}
	const acc: any[] = [docs[0]];
	for (let i = 1; i < docs.length; i++) {
		acc.push(b.hardline, docs[i]);
	}
	return b.group(acc);
}

// Quick conversion when we constructed a sub-doc but need a string for helpers
function toStringQuick(d: any): string {
	// As a fallback, join array-like docs or return string-ish

	// As a fallback, join array-like docs or return string-ish
	if (Array.isArray(d)) {
		return d.flat(Infinity).join("");
	}

	if (typeof d === "string") {
		return d;
	}
	return String(d);
}
