import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as M from "@yap/elaboration/shared/effects";

type Annotation = Extract<Src.Term, { type: "annotation" }>;

export const infer = (node: Annotation): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Annotation node" } }, function* () {
		const { term, ann } = node;

		const ctx = yield* M.reader.ask();

		// FIXME:TODO: This was a fix for allowing singleton numbers as annotations. The correct was is to pattern match on check(Lit.Num, Type), and allow that check to succeed
		const ast = yield* EB.check(ann, NF.Type);
		//const [_ann, kind]: EB.AST = yield* EB.Icit.insert.gen(ast[0]);
		const nf = NF.evaluate(ctx, ast[0]);

		//const [_ann, us] = yield* EB.check.gen(ann, nf);
		//const _ty = NF.evaluate(ctx, _ann);
		const [_term, us] = yield* EB.check(term, nf);

		return [_term, nf, us] satisfies EB.AST;
	});
