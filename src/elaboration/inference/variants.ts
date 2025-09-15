import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Variant = Extract<Src.Term, { type: "variant" }>;

export const infer = (variant: Variant): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", variant, { action: "infer", description: "Variant" }],
		V2.Do(() =>
			V2.local(
				EB.muContext,
				V2.Do(function* () {
					const [tm, us] = yield* EB.check.gen(variant, NF.Type);
					return [tm, NF.Type, us] satisfies EB.AST;
				}),
			),
		),
	);
