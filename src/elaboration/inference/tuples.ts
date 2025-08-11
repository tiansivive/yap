import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Tuple = Extract<Src.Term, { type: "tuple" }>;

export const infer = ({ row }: Tuple): EB.M.Elaboration<EB.AST> =>
	M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]);
