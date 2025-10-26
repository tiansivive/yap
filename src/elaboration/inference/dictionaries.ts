import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import { match } from "ts-pattern";

type Dictionary = Extract<Src.Term, { type: "dict" }>;

export const infer = (dict: Dictionary): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: dict, metadata: { action: "infer", description: "Dictionary" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const [tm1, ty1, us1] = yield EB.infer(dict.index);
			const [tm2, ty2, us2] = yield EB.infer(dict.term);
			const ctx = yield* V2.ask();
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
			return [EB.Constructors.Indexed(tm1, tm2, strategy), NF.Type, Q.add(us1, us2)] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
