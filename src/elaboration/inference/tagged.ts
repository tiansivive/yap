import * as F from "fp-ts/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as R from "@yap/shared/rows";

type Tagged = Extract<Src.Term, { type: "tagged" }>;

export const infer = ({ tag, term }: Tagged): EB.M.Elaboration<EB.AST> =>
	F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.bind("t", () => EB.infer(term)),
		M.fmap(({ t: [tm, ty, us], ctx }) => {
			const rvar: NF.Row = R.Constructors.Variable(EB.freshMeta(ctx.env.length, NF.Row));
			const row: NF.Row = NF.Constructors.Extension(tag, ty, rvar);
			const variant = NF.Constructors.Variant(row);

			const trow = EB.Constructors.Extension(tag, tm, { type: "empty" });
			const tagged = EB.Constructors.Struct(trow);
			return [tagged, variant, us];
		}),
	);
