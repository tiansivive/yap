import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as F from "fp-ts/lib/function";

type Hole = Extract<Src.Term, { type: "hole" }>;

export const infer = (h: Hole): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: h, metadata: { action: "infer", description: "Hole" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
			const ty = NF.evaluate(ctx, meta);
			// const modal = NF.infer(env, annotation);
			return [meta, ty, Q.noUsage(ctx.env.length)] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);
