import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";

type List = Extract<Src.Term, { type: "list" }>;

export const infer = ({ elements }: List): EB.M.Elaboration<EB.AST> =>
	M.chain(M.ask(), ctx => {
		const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
		const mvar = EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
		const v = NF.evaluate(ctx, mvar);

		const validate = F.flow(
			EB.infer,
			M.discard(([, ty]) => M.tell("constraint", { type: "assign", left: ty, right: v, lvl: ctx.env.length })),
		);
		return M.fmap(M.traverse(elements, validate), (es): EB.AST => {
			const usages = es.reduce((acc, [, , us]) => Q.add(acc, us), Q.noUsage(ctx.env.length));

			const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
			const values = NF.Constructors.App(indexing, v, "Explicit");

			const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }), "Implicit");

			const tm: EB.Term = {
				type: "Row",
				row: es.reduceRight(
					(r: EB.Row, [tm], i) => {
						const label = i.toString();
						return { type: "extension", label, value: tm, row: r };
					},
					{ type: "empty" },
				),
			};

			return [tm, NF.Constructors.Neutral(ty), usages];
		});
	});
