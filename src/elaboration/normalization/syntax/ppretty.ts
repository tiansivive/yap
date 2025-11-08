import { format, Plugin, doc as PrettierDoc } from "prettier";
import { match } from "ts-pattern";
import * as NF from "../index";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import * as EB from "@yap/elaboration";
import { PPretty } from "@yap/elaboration/pretty";
import { options } from "@yap/shared/config/options";
import { compose } from "../../unification";

const b = PrettierDoc.builders;

// Public API: pretty-print a Value using Prettier's layout engine
export async function Value(value: NF.Value, ctx: EB.DisplayContext, opts: { deBruijn: boolean } = { deBruijn: false }): Promise<string> {
	const plugin = makePlugin(value, ctx, opts);

	const out = await format("dummy", {
		parser: "yap-value-internal",
		plugins: [plugin],
		printWidth: 100,
		tabWidth: 2,
	} as any);
	return out.trimEnd();
}

// Synchronous version for when we're already inside a Prettier print context
export function ValueSync(value: NF.Value, ctx: EB.DisplayContext, opts: { deBruijn: boolean } = { deBruijn: false }): string {
	return toStringQuick(toDoc(value, ctx, opts));
}

// ----------------- Internal: Prettier plugin + printer -----------------

function makePlugin(value: NF.Value, ctx: EB.DisplayContext, opts: { deBruijn: boolean }): Plugin {
	return {
		languages: [{ name: "YapValue", parsers: ["yap-value-internal"] }],
		parsers: {
			"yap-value-internal": {
				parse(text: string, opts: any) {
					return value;
				},
				astFormat: "yap-value-ast",
				locEnd: () => 0,
				locStart: () => 0,
			},
		},
		printers: {
			"yap-value-ast": {
				print(path: any, opts: any) {
					const node = path.getValue() as NF.Value;
					return toDoc(node, ctx, opts);
				},
			},
		},
	};
}

export function toDoc(value: NF.Value, ctx: EB.DisplayContext, opts: { deBruijn: boolean }): any /* Doc */ {
	return match(value as NF.Value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => {
					const idx = ctx.env.length - 1 - lvl;
					const name = ctx.env[idx]?.name.variable ?? `L${lvl}`;
					return name + (opts.deBruijn ? `#L${lvl}` : "");
				})
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Label" }, ({ name }) => `:${name}`)
				.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
				.with({ type: "Meta" }, ({ val }) => {
					const m = ctx.zonker[val] ? toDoc(ctx.zonker[val], ctx, opts) : `?${val}`;
					return m;
				})
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value }) => toDoc(value, ctx, opts))
		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source)
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const binderHead = match(binder)
				.with({ type: "Lambda" }, ({ variable }) => ["λ", variable] as any)
				.with({ type: "Pi" }, ({ variable, annotation }) => ["Π(", variable, ": ", toDoc(annotation, ctx, opts), ")"] as any)
				.with({ type: "Mu" }, ({ variable, annotation }) => ["μ(", variable, ": ", toDoc(annotation, ctx, opts), ")"] as any)
				.exhaustive();

			const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? " => " : " -> ";

			const z = compose(ctx.zonker, closure.ctx.zonker);
			const extended = {
				...closure.ctx,
				metas: ctx.metas,
				zonker: z,
				env: [{ name: { variable: binder.variable } }, ...closure.ctx.env],
			} as Pick<EB.Context, "env" | "zonker" | "metas">;

			const printedEnv = extended.env.map(({ nf, name }) => {
				if (nf) {
					return `${name.variable} = ${NF.display(nf, ctx, opts)}`;
				}
				return name.variable;
			});

			const prettyEnv = printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";

			// Use EB.Display.Term for now to avoid circular dependency
			const termStr = PPretty.toDoc(closure.term, extended, opts);
			//EB.Display.Term(closure.term, extended, opts);

			return b.group([b.group(binderHead), arr, b.group(["(closure: ", termStr, " -| ", prettyEnv, ")"])]);
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const f = toDoc(func, ctx, opts);
			const a = toDoc(arg, ctx, opts);

			const needsParenFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
			const needsParenArg = arg.type === "Abs" || arg.type === "App";

			return b.group([needsParenFn ? ["(", f, ")"] : f, " ", Icit.display(icit), needsParenArg ? ["(", a, ")"] : a]);
		})
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: (term: NF.Value) => toStringQuick(toDoc(term, ctx, opts)),
				var: (v: NF.Variable) => toStringQuick(toDoc(NF.mk({ type: "Var", variable: v }), ctx, opts)),
			})(row),
		)
		.with({ type: "Modal" }, ({ modalities, value }) => {
			return b.group(["<", Q.display(modalities.quantity), "> ", toDoc(value, ctx, opts), " [| ", toDoc(modalities.liquid, ctx, opts), " |]"]);
		})
		.with({ type: "External" }, external => {
			const args = external.args.map(arg => b.group(["(", toDoc(arg, ctx, opts), ")"]));
			return b.group(["(", external.name, ": ", ...args, ")"]);
		})
		.with({ type: "Existential" }, existential => {
			const xtended = { ...ctx, env: [{ name: { variable: existential.variable } }, ...ctx.env] } as EB.Context;
			const prettyEnv = EB.Display.Env(xtended, opts);
			return b.group([
				"Σ(",
				existential.variable,
				": ",
				toDoc(existential.annotation, ctx, opts),
				"). ",
				b.indent([b.line, "<packed: ", toDoc(existential.body.value, xtended, opts), " -| ", prettyEnv, ">"]),
			]);
		})
		.exhaustive();
}

// ----------------- Small utilities -----------------

function toStringQuick(d: any): string {
	// Flatten array-like docs or return string-ish
	if (Array.isArray(d)) {
		return d.flat(Infinity).join("");
	}
	if (typeof d === "string") {
		return d;
	}
	return String(d);
}
