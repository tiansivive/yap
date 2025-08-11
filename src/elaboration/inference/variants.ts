import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Variant = Extract<Src.Term, { type: "variant" }>;

export const infer = (variant: Variant): EB.M.Elaboration<EB.AST> =>
	M.local(
		EB.muContext,
		M.fmap(EB.check(variant, NF.Type), ([tm, us]): EB.AST => [tm, NF.Type, us]),
	);
