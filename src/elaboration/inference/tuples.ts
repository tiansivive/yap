import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as Src from "@yap/src/index";

type Tuple = Extract<Src.Term, { type: "tuple" }>;

export const infer = (tuple: Tuple): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: tuple, metadata: { action: "infer", description: "Tuple" } }, () =>
		EB.Struct.commonStructInference(tuple.row),
	);
