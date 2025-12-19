import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import assert from "node:assert";

type Shift = Extract<Src.Term, { type: "shift" }>;

export const infer = (shift: Shift): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			// Get the current handler from the context
			if (ctx.handlers.length === 0) {
				throw new Error("shift without enclosing reset");
			}

			const [h] = ctx.handlers;

			const desugared: Src.Term = {
				type: "application",
				icit: "Explicit",
				fn: {
					type: "application",
					icit: "Explicit",
					fn: h.src,
					arg: { type: "var", variable: { type: "name", value: "k", location: shift.continuation.location }, location: shift.location },
					location: shift.location,
				},
				arg: shift.term,
				location: shift.location,
			};

			const [ktm, kty] = yield* EB.infer.gen(shift.continuation);

			const [bodyTm, answer, us] = yield* V2.local(ctx => EB.bind(ctx, { type: "Lambda", variable: "k" }, kty, "source"), EB.infer(desugared));

			const lambda = EB.Constructors.Lambda("k", "Explicit", bodyTm, NF.quote(ctx, ctx.env.length, kty));

			const app = EB.Constructors.App("Explicit", ktm, EB.Constructors.Shift(lambda));
			return [app, answer, us] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
