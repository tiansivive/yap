import { match } from "ts-pattern";
import * as NF from "../index";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as PP from "@yap/shared/pretty";

import * as EB from "@yap/elaboration";
import { options } from "@yap/shared/config/options";
import { compose } from "../../unification";

import * as Null from "@yap/utils";

export const doc = (value: NF.Value, ctx: EB.DisplayContext, opts = { deBruijn: false }): PP.Doc =>
	match(value as NF.Value)
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
					const m = ctx.zonker[val] ? doc(ctx.zonker[val], ctx, opts) : `?${val}`;
					return m;
				})
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value: v }) => doc(v, ctx, opts))
		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source)
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b: PP.Doc = match(binder)
				.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
				.with({ type: "Pi" }, ({ variable, annotation }) => ["Π(", variable, ": ", doc(annotation, ctx, opts), ")"])
				.with({ type: "Mu" }, ({ variable, annotation }) => ["μ(", variable, ": ", doc(annotation, ctx, opts), ")"])
				.with({ type: "Sigma" }, ({ variable }) => ["Σ(", variable, ": ", doc(binder.annotation, ctx, opts), ")"])
				.exhaustive();

			const arrow = match(binder)
				.with({ type: "Sigma" }, () => ".")
				.with({ icit: "Implicit" }, () => "=>")
				.otherwise(() => "->");

			const z = compose(ctx.zonker, closure.ctx.zonker);

			const extended =
				binder.type === "Sigma"
					? closure.ctx
					: ({
							...closure.ctx,
							metas: ctx.metas,
							zonker: z,
							env: [{ name: { variable: binder.variable } }, ...closure.ctx.env],
						} as Pick<EB.Context, "env" | "zonker" | "metas">);

			const printedEnv = extended.env.map(({ name }) => name.variable);
			const prettyEnv = printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";

			return PP.group([b, " ", arrow, PP.nest(2, [PP.line, PP.closure(EB.Display.doc(closure.term, extended, opts), prettyEnv)])]);
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const needsFnParens = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
			const needsArgParens = arg.type === "Abs" || arg.type === "App";
			return PP.app(PP.parensIf(needsFnParens, doc(func, ctx, opts)), Icit.display(icit), PP.parensIf(needsArgParens, doc(arg, ctx, opts)));
		})
		.with({ type: "Row" }, ({ row }) =>
			R.displayDoc({
				term: (t: NF.Value) => doc(t, ctx, opts),
				var: (v: NF.Variable) => doc(NF.mk({ type: "Var", variable: v }), ctx, opts),
			})(row),
		)
		.with({ type: "Modal" }, ({ modalities, value: v }) => [
			"<",
			Q.display(modalities.quantity),
			"> ",
			doc(v, ctx, opts),
			" [| ",
			doc(modalities.liquid, ctx, opts),
			" |]",
		])
		.with({ type: "External" }, external => {
			const args = external.args.map(a => ["(", doc(a, ctx, opts), ")"]);
			return PP.group(["(", external.name, ":", PP.nest(2, [PP.line, ...PP.intersperse(" ", args)]), ")"]);
		})
		.with({ type: "Existential" }, existential => {
			const xtended = { ...ctx, env: [{ name: { variable: existential.variable } }, ...ctx.env] } as EB.Context;
			const prettyEnv = EB.Display.Env(xtended, opts);
			return PP.group([
				"∃(",
				existential.variable,
				": ",
				doc(existential.annotation, ctx, opts),
				").",
				PP.nest(2, [PP.line, "<packed: ", doc(existential.body.value, xtended, opts), " -| ", prettyEnv, ">"]),
			]);
		})
		.with({ type: "Reset" }, ({ closure: cls }) => ["reset |", closureDoc(cls, ctx, opts), "|"])
		.with({ type: "Shift" }, ({ closure: cls }) => ["shift (", closureDoc(cls, ctx, opts), ")"])
		.exhaustive();

export const display = (value: NF.Value, ctx: EB.DisplayContext, opts = { deBruijn: false }): string => PP.render(doc(value, ctx, opts));

const closureDoc = (closure: NF.Closure, ctx: EB.DisplayContext, opts = { deBruijn: false }): PP.Doc => {
	const z = compose(ctx.zonker, closure.ctx.zonker);
	const extended: EB.DisplayContext = { ...closure.ctx, zonker: z };

	const printedEnv = extended.env.map(({ nf, name }) => {
		if (nf) {
			return `${name.variable} = ${NF.display(nf, extended, opts)}`;
		}
		return name.variable;
	});
	const prettyEnv = printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";
	return PP.closure(EB.Display.doc(closure.term, extended, opts), prettyEnv);
};
