import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as Src from "@yap/src/index";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import { NF } from "@yap/elaboration";

type Literal = Extract<Src.Term, { type: "lit" }>;

export const infer = (lit: Literal): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: lit, metadata: { action: "infer", description: "Literal" } }, function* () {
		const { value } = lit;
		const ctx = yield* M.reader.ask();
		const atom: Lit.Literal = match(value)
			.with({ type: "String" }, _ => Lit.Atom("String"))
			.with({ type: "Num" }, _ => Lit.Atom("Num"))
			.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
			.with({ type: "unit" }, _ => Lit.Atom("Unit"))
			.with({ type: "Atom" }, _ => Lit.Atom("Type"))
			.exhaustive();

		return [EB.Constructors.Lit(value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length)] satisfies EB.AST;
	});
