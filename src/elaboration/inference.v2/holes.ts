import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";

import * as F from "fp-ts/lib/function";

type Hole = Extract<CST.Types.SyntaxNode, { type: "hole" }>;

export const infer = (h: Hole): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: h, metadata: { action: "infer", description: "Hole" } },
		M.Do(function* () {
			const ctx = yield* M.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			const ty = NF.evaluate(ctx, meta);
			// const modal = NF.infer(env, annotation);
			return [meta, ty] satisfies tmp.Typing;
		}),
	);
infer.gen = F.flow(infer, M.pure);
