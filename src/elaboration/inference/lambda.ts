import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Log from "@yap/shared/logging";

import { Liquid } from "@yap/verification/modalities";

type Lambda = Extract<Src.Term, { type: "lambda" }>;

export const infer = (lam: Lambda): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: lam, metadata: { action: "infer", description: "Lambda" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			const [ann, us] = lam.annotation
				? yield* EB.check.gen(lam.annotation, NF.Type)
				: ([EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);

			const ty = NF.evaluate(ctx, ann);

			const ast = yield* V2.local(
				_ctx => EB.bind(_ctx, { type: "Lambda", variable: lam.variable }, ty),
				V2.Do(function* () {
					const inferred = yield* EB.infer.gen(lam.body);
					const [bTerm, bType, [vu, ...bus]] = yield* EB.Icit.insert.gen(inferred);
					//yield* V2.tell("constraint", { type: "usage", expected: mty[1], computed: vu });

					const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm, ty);
					const pi = NF.Constructors.Pi(lam.variable, lam.icit, ty, NF.closeVal(ctx, bType));
					return [tm, pi, bus] satisfies EB.AST; // Remove the usage of the bound variable
				}),
			);

			return ast as EB.AST; // Remove the usage of the bound variable
		}),
	);

infer.gen = F.flow(infer, V2.pure);
