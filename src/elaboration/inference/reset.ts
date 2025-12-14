import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { update } from "@yap/utils";

type Reset = Extract<Src.Term, { type: "reset" }>;

export const infer = (reset: Reset): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: reset, metadata: { action: "infer", description: "Reset" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			// First, infer the handler lambda
			const [handlerTerm, handlerType, handlerUsages] = yield* EB.infer.gen(reset.handler);

			// The handler should be a function type: (k: A -> R) -> V -> R
			// where A is the answer type, R is the result type, and V is the shift value type
			// NOTE: Structural type checking is deferred to answer-type polymorphism.
			// Future work: Add explicit handler type constraints during elaboration

			// Create a meta for the answer type (type of values that can be returned from within reset)
			const answerTypeMeta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const answerType = NF.evaluate(ctx, answerTypeMeta);

			// Add the handler to the context stack along with the answer type
			// The answer type is used by shift to create proper continuations
			const [enclosedTerm, enclosedType, enclosedUsages] = yield* V2.local(
				_ctx => update(_ctx, "handlers", hs => [handlerTerm, ...hs]),
				V2.Do(function* () {
					// Infer the enclosed term with the handler in scope
					// The enclosed term is transformed into CPS by shift operations
					return yield* EB.infer.gen(reset.term);
				}),
			);

			// The reset term has the result type which is the type of the enclosed term
			// This implements answer-type polymorphism: reset e : R where e : A
			// In the presence of no shifts, A = R
			// With shifts, the handler transforms A to R

			const tm = EB.Constructors.Reset(enclosedTerm);
			const ty = enclosedType;

			return [tm, ty, Q.add(handlerUsages, enclosedUsages)] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
