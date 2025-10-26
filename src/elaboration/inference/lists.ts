import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";

type List = Extract<Src.Term, { type: "list" }>;

export const infer = (list: List): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: list, metadata: { action: "infer", description: "List" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			const v = NF.evaluate(ctx, mvar);

			const validate = (tm: Src.Term) =>
				V2.Do(function* () {
					const inferred = yield* EB.infer.gen(tm);
					yield* V2.tell("constraint", { type: "assign", left: inferred[1], right: v, lvl: ctx.env.length });
					return inferred;
				});

			const es = yield* V2.pure(V2.traverse(list.elements, validate));
			const usages = es.reduce((acc, [, , us]) => Q.add(acc, us), Q.noUsage(ctx.env.length));

			const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
			const values = NF.Constructors.App(indexing, v, "Explicit");

			const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }), "Implicit");

			const row = es.reduceRight(
				(r: EB.Row, [tm], i) => {
					const label = i.toString();
					return { type: "extension", label, value: tm, row: r } satisfies EB.Row;
				},
				{ type: "empty" },
			);
			return [EB.Constructors.Row(row), NF.Constructors.Neutral(ty), usages] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);
