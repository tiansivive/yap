import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import { Liquid as L } from "@yap/verification/modalities";

export const Liquid = {
	hole: function* (domain: NF.Value) {
		const ctx = yield* M.reader.ask();
		return yield* EB.freshMeta(ctx.env.length, yield* L.Predicate.Kind(domain), "Predicate");
	},
	typecheck: function* (refinement: Src.Term, ty: NF.Value) {
		const kind = yield* L.Predicate.Kind(ty);
		const [tm] = yield* EB.Check.val(refinement, kind);
		return tm;
	},
};
