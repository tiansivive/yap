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

			// Add the handler to the context stack
			const [enclosedTerm, enclosedType, enclosedUsages] = yield* V2.local(
				_ctx => update(_ctx, "handlers", hs => [handlerTerm, ...hs]),
				V2.Do(function* () {
					// Infer the enclosed term with the handler in scope
					return yield* EB.infer.gen(reset.term);
				}),
			);

			// The reset term has the result type R
			// The enclosed term has type A, but reset transforms it to R
			// For answer-type polymorphism: reset e : R where e : A

			const tm = EB.Constructors.Reset(enclosedTerm);
			// Answer-type polymorphism: the type of reset is the result type
			const ty = enclosedType;

			return [tm, ty, Q.add(handlerUsages, enclosedUsages)] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
