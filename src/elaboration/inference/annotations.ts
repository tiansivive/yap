import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { Usages } from "@yap/shared/modalities/multiplicity";
import { Unwrap } from "../shared/monad.v2";
import { isEqual } from "lodash";

type Annotation = Extract<Src.Term, { type: "annotation" }>;

type Checked = Unwrap<ReturnType<typeof EB.check>>;

export const infer = (node: Annotation): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Annotation node" } },
		V2.Do<EB.AST, Checked>(function* () {
			const { term, ann } = node;

			const ctx = yield* V2.ask();

			// FIXME:TODO: This was a fix for allowing singleton numbers as annotations. The correct was is to pattern match on check(Lit.Num, Type), and allow that check to succeed
			const ast = yield* EB.infer.gen(ann);
			const [_ann, kind]: EB.AST = yield* EB.Icit.insert.gen(ast);
			const nf = NF.evaluate(ctx, _ann);

			//const [_ann, us] = yield* EB.check.gen(ann, nf);
			//const _ty = NF.evaluate(ctx, _ann);
			const [_term, us] = yield* EB.check.gen(term, nf);

			return [_term, nf, us] satisfies EB.AST;
		}),
	);
