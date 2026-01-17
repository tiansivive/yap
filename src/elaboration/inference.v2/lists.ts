import * as F from "fp-ts/lib/function";

import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";

import * as NF from "@yap/elaboration/normalization";

import * as Lit from "@yap/shared/literals";
import * as tmp from "./tmp";

type List = Extract<CST.Types.SyntaxNode, { type: "list" }>;

export const infer = (list: List): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: list, metadata: { action: "infer", description: "List" } },
		M.Do(function* () {
			const ctx = yield* M.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			const v = NF.evaluate(ctx, mvar);

			const validate = (node: CST.Types.SyntaxNode) =>
				M.Do(function* () {
					const inferred = yield* tmp.infer(node);
					yield* M.tell("constraint", { type: "assign", left: inferred[1], right: v, lvl: ctx.env.length });
					return inferred;
				});

			const { element: elements } = CST.Utils.extractFields(list, ["element"]);

			const es = yield* M.pure(M.traverse(elements, validate));
			//const usages = es.reduce((acc, [, , us]) => Q.add(acc, us), Q.noUsage(ctx.env.length));

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
			return [EB.Constructors.Array(row), NF.Constructors.Neutral(ty)] satisfies tmp.Typing;
		}),
	);
infer.gen = F.flow(infer, M.pure);
