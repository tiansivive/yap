import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/lib/function";

type Tuple = Extract<Src.Term, { type: "tuple" }>;

export const infer = (tuple: Tuple): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", tuple, { action: "infer", description: "Tuple" }],
		V2.Do(function* () {
			const [row, ty, qs] = yield* EB.Rows.resolveSigmas.gen(tuple.row);
			return [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs];
		}),
	);
infer.gen = F.flow(infer, V2.pure);
