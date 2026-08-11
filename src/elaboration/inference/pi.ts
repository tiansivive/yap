import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Pi = Extract<Src.Term, { type: "pi" } | { type: "arrow" }>;

export const infer = (pi: Pi): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: pi, metadata: { action: "infer", description: "Pi" } }, function* () {
		const v = pi.type === "pi" ? pi.variable : `t${EB.nextCount()}`;
		const body = pi.type === "pi" ? pi.body : pi.rhs;

		const ann = pi.type === "pi" ? pi.annotation : pi.lhs;
		const [ty, us] = yield* EB.check(ann, NF.Type);
		const va = yield* NF.normalize(ty);

		const [bodyTm, [, ...bus]] = yield* M.reader.local(_ctx => EB.bind(_ctx, { type: "Pi", variable: v }, va), EB.check(body, NF.Type));

		return [EB.Constructors.Pi(v, pi.icit, ty, bodyTm), NF.Type, Q.add(us, bus)] satisfies EB.AST;
	});
