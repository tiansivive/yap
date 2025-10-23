import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Src from "@yap/src/index";

import * as F from "fp-ts/lib/function";

type Tuple = Extract<Src.Term, { type: "tuple" }>;

export const infer = (tuple: Tuple): V2.Elaboration<EB.AST> =>
	V2.track({ tag: "src", type: "term", term: tuple, metadata: { action: "infer", description: "Tuple" } }, EB.Struct.commonStructInference(tuple.row));
infer.gen = F.flow(infer, V2.pure);
