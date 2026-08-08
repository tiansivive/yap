import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

import * as M from "@yap/elaboration/shared/effects";

import { Liquid as L } from "@yap/verification/modalities";

export const Liquid = {
	typecheck: function* (refinement: Src.Term, ty: NF.Value) {
		const ctx = yield* M.reader.ask();
		const [tm] = yield* EB.Check.val(refinement, L.Predicate.Kind(ctx, ty));
		return tm;
	},
};
