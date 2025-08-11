import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Annotation = Extract<Src.Term, { type: "annotation" }>;

export const infer = ({ term, ann }: Annotation): EB.M.Elaboration<EB.AST> =>
	M.chain(M.ask(), ctx =>
		F.pipe(
			M.Do,
			M.let("ann", EB.check(ann, NF.Type)),
			M.bind("type", ({ ann: [type, us] }) => {
				const val = NF.evaluate(ctx, type);
				return M.of([val, us] as const);
			}),
			M.bind("term", ({ type: [type, us] }) => EB.check(term, type)),
			M.fmap(({ term: [term], type: [type, us] }): EB.AST => [term, type, us]),
		),
	);
