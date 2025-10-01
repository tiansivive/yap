import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/lib/function";

type Struct = Extract<Src.Term, { type: "struct" }>;

export const infer = (struct: Struct): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: struct, metadata: { action: "infer", description: "Struct" } },
		V2.Do(function* () {
			const [row, ty, qs] = yield* EB.Rows.resolveSigmas.gen(struct.row);
			return [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs];
		}),
	);
infer.gen = F.flow(infer, V2.pure);
