import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";

import * as F from "fp-ts/lib/function";
import * as Lit from "@yap/shared/literals";
import { update } from "@yap/utils";
import { match } from "ts-pattern";

type Dictionary = Extract<CST.Types.SyntaxNode, { type: "dict" }>;

export const infer = (dict: Dictionary): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: dict, metadata: { action: "infer", description: "Dictionary" } },
		M.Do(function* () {
			const { index, type } = CST.Utils.extractFields(dict, "index", "type");
			const [tm1, ty1] = yield* tmp.infer(index);
			const [tm2, ty2] = yield* tmp.infer(type);
			const ctx = yield* M.ask();
			const m = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const strategy = match(tm1)
				// We check free variables for primitive types because elaboration tries to preserve variable names. This helps with displaying, debugging, and error messages.
				// TODO: Maybe add some Primitive wrappers to hide the free variable nature of these terms?
				.with({ type: "Lit", value: { type: "Atom", value: "String" } }, { type: "Var", variable: { type: "Free", name: "String" } }, () =>
					EB.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }),
				)
				.with({ type: "Lit", value: { type: "Atom", value: "Num" } }, { type: "Var", variable: { type: "Free", name: "Num" } }, () =>
					EB.Constructors.Var({ type: "Foreign", name: "defaultArray" }),
				)
				.otherwise(() => EB.Constructors.Var(m));
			return [EB.Constructors.Indexed(tm1, tm2, strategy), NF.Type] satisfies tmp.Typing;
		}),
	);

infer.gen = F.flow(infer, M.pure);
