import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

type Dictionary = Extract<Src.Term, { type: "dict" }>;

export const infer = (dict: Dictionary): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", dict, { action: "infer", description: "Dictionary" }],
		V2.Do<EB.AST, EB.AST>(function* () {
			const [tm1, ty1, us1] = yield EB.infer(dict.index);
			const [tm2, ty2, us2] = yield EB.infer(dict.term);
			const ctx = yield* V2.ask();
			const strategy = EB.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			return [EB.Constructors.Indexed(tm1, tm2, strategy), NF.Type, Q.add(us1, us2)] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
