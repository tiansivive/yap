import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

type Hole = Extract<Src.Term, { type: "hole" }>;

export const infer = (h: Hole): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: h, metadata: { action: "infer", description: "Hole" } }, function* () {
		const ctx = yield* M.reader.ask();
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
		const ty = NF.evaluate(ctx, meta);
		// const modal = NF.infer(env, annotation);
		return [meta, ty, Q.noUsage(ctx.env.length)] satisfies EB.AST;
	});
