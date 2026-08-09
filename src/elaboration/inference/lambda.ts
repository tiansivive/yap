import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { update } from "@yap/utils";
import * as Metas from "@yap/elaboration/shared/metas";

type Lambda = Extract<Src.Term, { type: "lambda" }>;

export const infer = (lam: Lambda): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: lam, metadata: { action: "infer", description: "Lambda" } }, function* () {
		const ctx = yield* M.reader.ask();

		const [ann, _us] = lam.annotation
			? yield* EB.check(lam.annotation, NF.Type)
			: ([EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);

		const ty = NF.evaluate(ctx, ann);

		const registry = yield* Metas.registry.get();
		const metas = Metas.asContext(ctx, registry);

		const ast = yield* M.reader.local(
			_ctx => {
				const xtended = EB.bind(_ctx, { type: "Lambda", variable: lam.variable }, ty);
				return update(xtended, "metas", ms => ({ ...ms, ...metas }));
			},
			(function* () {
				const inferred = yield* EB.infer(lam.body);
				const [bTerm, bType, [_vu, ...bus]] = yield* EB.Icit.insert(inferred);
				//yield* M.constrain({ type: "usage", expected: mty[1], computed: vu });

				const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm, ann);
				const pi = NF.Constructors.Pi(lam.variable, lam.icit, ty, NF.closeVal(ctx, bType));
				const piTerm = NF.quote(ctx, ctx.env.length, pi);
				return [EB.Constructors.Ann(tm, piTerm), pi, bus] satisfies EB.AST;
			})(),
		);

		return ast satisfies EB.AST; // Remove the usage of the bound variable
	});
