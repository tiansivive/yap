import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { Usages } from "@yap/shared/modalities/multiplicity";
import { Unwrap } from "../shared/monad.v2";

type Annotation = Extract<Src.Term, { type: "annotation" }>;

type Checked = Unwrap<ReturnType<typeof EB.check>>;

export const infer = (node: Annotation): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", node, { action: "infer", description: "Annotation node" }],
		V2.Do<EB.AST, Checked>(function* () {
			const { ann, term } = node;

			const [_ann, us] = yield* EB.check.gen(ann, NF.Type);
			const ctx = yield* V2.ask();
			const _ty = NF.evaluate(ctx, _ann);
			const [_term] = yield* EB.check.gen(term, _ty);

			return [_term, _ty, us] satisfies EB.AST;
		}),
	);
