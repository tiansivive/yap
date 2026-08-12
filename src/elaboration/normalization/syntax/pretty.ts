import { match } from "ts-pattern";
import * as NF from "../index";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as PP from "@yap/shared/pretty";
import * as R from "@yap/shared/rows";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import { bound, Display, rowDocs } from "@yap/elaboration/pretty/pretty";

const identityRow = { term: (d: PP.Doc) => d, var: (v: PP.Doc) => v };

export const doc = function* (value: NF.Value, opts = { deBruijn: false }): Display<PP.Doc> {
	const go = (v: NF.Value) => doc(v, opts);

	return yield* match(value)
		.with({ type: "Lit" }, function* ({ value: lit }) {
			return Lit.display(lit);
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* ({ lvl }) {
					const { env } = yield* M.reader.ask();
					const idx = env.length - 1 - lvl;
					const name = env[idx]?.name.variable ?? `L${lvl}`;
					return name + (opts.deBruijn ? `#L${lvl}` : "");
				})
				.with({ type: "Free" }, function* ({ name }) {
					return name;
				})
				.with({ type: "Label" }, function* ({ name }) {
					return `:${name}`;
				})
				.with({ type: "Foreign" }, function* ({ name }) {
					return `FFI.${name}`;
				})
				.with({ type: "Meta" }, function* ({ val }) {
					const entry = (yield* Metas.registry.get())[val];
					return entry?.solution ? yield* go(entry.solution) : `?${val}`;
				})
				.exhaustive();
		})
		.with({ type: "Neutral" }, function* ({ value: v }) {
			return yield* go(v);
		})
		.with(NF.Patterns.Proj, function* ({ base, label }) {
			return [yield* go(base), ".", label] satisfies PP.Doc;
		})
		.with(NF.Patterns.Match, function* ({ scrutinee }) {
			return ["match ", yield* go(scrutinee), " …"] satisfies PP.Doc;
		})
		.with(NF.Patterns.Inj, function* ({ base, label, injected }) {
			return ["inj ", label, " ", yield* go(injected), " into ", yield* go(base)] satisfies PP.Doc;
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder }) {
			return binder.source;
		})
		.with({ type: "Abs" }, function* ({ binder, closure }) {
			const b: PP.Doc = yield* match(binder)
				.with({ type: "Lambda" }, function* ({ variable, annotation }) {
					return ["λ(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.with({ type: "Pi" }, function* ({ variable, annotation }) {
					return ["Π(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.with({ type: "Mu" }, function* ({ variable, annotation }) {
					return ["μ(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.with({ type: "Sigma" }, function* ({ variable, annotation }) {
					return ["Σ(", variable, ": ", yield* go(annotation), ")"] satisfies PP.Doc;
				})
				.exhaustive();

			const arrow = match(binder)
				.with({ type: "Sigma" }, () => ".")
				.with({ icit: "Implicit" }, () => "=>")
				.otherwise(() => "->");

			/* The body displays under the closure's own scope: the stored env, plus the binder being introduced. */
			const scope = binder.type === "Sigma" ? closure.ctx : bound(binder.variable)(closure.ctx);
			const body = yield* M.reader.local(_ => scope, EB.Display.doc(closure.term, opts));

			return PP.group([b, " ", arrow, PP.nest(2, [PP.line, PP.closure(body, EB.Display.Env(scope.env))])]);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			const needsFnParens = func.type !== "Var" && func.type !== "Lit" && func.type !== "App";
			const needsArgParens = arg.type === "Abs" || arg.type === "App";
			return PP.app(PP.parensIf(needsFnParens, yield* go(func)), Icit.display(icit), PP.parensIf(needsArgParens, yield* go(arg)));
		})
		.with({ type: "Row" }, function* ({ row }) {
			return R.displayDoc(identityRow)(yield* rowDocs(row, go, (v: NF.Variable) => go(NF.mk({ type: "Var", variable: v }))));
		})
		.with({ type: "Modal" }, function* ({ modalities, value: v }) {
			return ["<", Q.display(modalities.quantity), "> ", yield* go(v), " [| ", yield* go(modalities.liquid), " |]"] satisfies PP.Doc;
		})
		.with({ type: "External" }, function* (external) {
			const args = yield* Eff.traverse(external.args, function* (a): Display<PP.Doc> {
				return ["(", yield* go(a), ")"] satisfies PP.Doc;
			});
			return PP.group(["(", external.name, ":", PP.nest(2, [PP.line, ...PP.intersperse(" ", args)]), ")"]);
		})
		.with({ type: "Existential" }, function* (existential) {
			const ctx = yield* M.reader.ask();
			const xtended = bound(existential.variable)(ctx);
			const packed = yield* M.reader.local(_ => xtended, go(existential.body.value));
			return PP.group([
				"∃(",
				existential.variable,
				": ",
				yield* go(existential.annotation),
				").",
				PP.nest(2, [PP.line, "<packed: ", packed, " -| ", EB.Display.Env(xtended.env), ">"]),
			]);
		})
		.exhaustive();
};

export const display = function* (value: NF.Value, opts = { deBruijn: false }): Display<string> {
	return PP.render(yield* doc(value, opts));
};
