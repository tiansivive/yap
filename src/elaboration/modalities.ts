import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

import { Liquid as L } from "@yap/verification/modalities";

export const Liquid = {
	typecheck: function* (refinement: Src.Term, ty: NF.Value) {
		const kind = yield* L.Predicate.Kind(ty);
		const [tm] = yield* EB.Check.val(refinement, kind);
		return tm;
	},
};
