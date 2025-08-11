import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Struct = Extract<Src.Term, { type: "struct" }>;

export const infer = ({ row }: Struct): EB.M.Elaboration<EB.AST> =>
	M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]);
