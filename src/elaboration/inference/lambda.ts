import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Lambda = Extract<Src.Term, { type: "lambda" }>;

export const infer = (lam: Lambda): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: lam, metadata: { action: "infer", description: "Lambda" } }, function* () {
		const ctx = yield* M.reader.ask();

		const [ann, _us] = lam.annotation
			? yield* EB.check(lam.annotation, NF.Type)
			: ([EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);

		const ty = yield* NF.normalize(ann);

		const ast = yield* M.reader.local(
			_ctx => EB.bind(_ctx, { type: "Lambda", variable: lam.variable }, ty),
			(function* () {
				const inferred = yield* EB.infer(lam.body);
				const [bTerm, bType, [_vu, ...bus]] = yield* EB.Icit.insert(inferred);
				//yield* M.constrain({ type: "usage", expected: mty[1], computed: vu });

				const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm, ann);
				const pi = NF.Constructors.Pi(lam.variable, lam.icit, ty, yield* NF.closeVal(bType));
				const piTerm = yield* NF.quote(ctx.env.length, pi);
				return [EB.Constructors.Ann(tm, piTerm), pi, bus] satisfies EB.AST;
			})(),
		);

		return ast satisfies EB.AST; // Remove the usage of the bound variable
	});
