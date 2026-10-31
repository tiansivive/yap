import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";

type List = Extract<Src.Term, { type: "list" }>;

export const infer = (list: List): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: list, metadata: { action: "infer", description: "List" } }, function* () {
		const ctx = yield* M.reader.ask();
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
		const v = yield* NF.normalize(mvar);

		const validate = function* (tm: Src.Term) {
			const inferred = yield* EB.infer(tm);
			yield* M.constrain({ type: "assign", left: inferred[1], right: v, lvl: ctx.env.length });
			return inferred;
		};

		const es = yield* M.traverse(list.elements, validate);
		const usages = es.reduce((acc, [, , us]) => Q.add(acc, us), Q.noUsage(ctx.env.length));

		const ty = NF.Constructors.Indexed(NF.Constructors.Lit(Lit.Atom("Num")), v, NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }));

		const row: EB.Row = R.Constructors.Row(es.map(([tm], i) => ({ label: i.toString(), value: tm })));
		return [EB.Constructors.Array(row), ty, usages] satisfies EB.AST;
	});
