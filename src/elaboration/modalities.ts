import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import { Liquid as L } from "@yap/verification/modalities";

export const Liquid = {
	typecheck: function* (refinement: Src.Term, ty: NF.Value) {
		const ctx = yield* V2.ask();
		const [tm] = yield* EB.Check.val.gen(refinement, L.Predicate.Kind(ctx, ty));
		return tm;
	},
};
