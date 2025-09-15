import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as F from "fp-ts/lib/function";
import * as Src from "@yap/src/index";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";

type Literal = Extract<Src.Term, { type: "lit" }>;

export const infer = (lit: Literal): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", lit, { action: "infer", description: "Literal" }],
		V2.Do(function* () {
			const { value } = lit;
			const ctx = yield* V2.ask();
			const atom: Lit.Literal = match(value)
				.with({ type: "String" }, _ => Lit.Atom("String"))
				.with({ type: "Num" }, _ => Lit.Atom("Num"))
				.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
				.with({ type: "unit" }, _ => Lit.Atom("Unit"))
				.with({ type: "Atom" }, _ => Lit.Atom("Type"))
				.exhaustive();

			return [{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
