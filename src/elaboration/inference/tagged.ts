import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as R from "@yap/shared/rows";

type Tagged = Extract<Src.Term, { type: "tagged" }>;

export const infer = (tagged: Tagged): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: tagged, metadata: { action: "infer", description: "Tagged" } }, function* () {
		const { tag, term } = tagged;

		const [tm, ty, us] = yield* EB.infer(term);
		const ctx = yield* M.reader.ask();
		const rvar: NF.Row = R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
		const row: NF.Row = NF.Constructors.Extension(tag, ty, rvar);
		const variant = NF.Constructors.Variant(row);

		return [EB.Constructors.Tagged(tag, tm), variant, us] satisfies EB.AST;
	});
