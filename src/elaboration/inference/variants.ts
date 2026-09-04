import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Variant = Extract<Src.Term, { type: "variant" }>;

export const infer = (variant: Variant): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: variant, metadata: { action: "infer", description: "Variant" } }, function* () {
		return yield* M.reader.local(
			EB.muContext,
			(function* () {
				const [tm, us] = yield* EB.check(variant, NF.Type);
				return [tm, NF.Type, us] satisfies EB.AST;
			})(),
		);
	});
