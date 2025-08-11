import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";

type Literal = Extract<Src.Term, { type: "lit" }>;

export const infer = ({ value }: Literal): EB.M.Elaboration<EB.AST> =>
	M.chain(M.ask(), ctx => {
		const atom: Lit.Literal = match(value)
			.with({ type: "String" }, _ => Lit.Atom("String"))
			.with({ type: "Num" }, _ => Lit.Atom("Num"))
			.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
			.with({ type: "unit" }, _ => Lit.Atom("Unit"))
			.with({ type: "Atom" }, _ => Lit.Atom("Type"))
			.exhaustive();

		return M.of<EB.AST>([{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)]);
	});
