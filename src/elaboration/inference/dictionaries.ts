import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

type Dictionary = Extract<Src.Term, { type: "dict" }>;

export const infer = ({ index, term }: Dictionary): EB.M.Elaboration<EB.AST> =>
	F.pipe(
		M.Do,
		M.let("index", EB.infer(index)),
		M.let("term", EB.infer(term)),
		M.fmap(({ index: [tm, , us], term: [tm2, , us2] }): EB.AST => {
			const indexed = EB.Constructors.Indexed(tm, tm2);
			return [indexed, NF.Type, Q.add(us, us2)];
		}),
	);
