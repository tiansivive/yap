import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Pi = Extract<Src.Term, { type: "pi" } | { type: "arrow" }>;

export const infer = (pi: Pi): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", pi, { action: "infer", description: "Pi" }],
		V2.Do(function* () {
			const v = pi.type === "pi" ? pi.variable : `t${EB.nextCount()}`;
			const body = pi.type === "pi" ? pi.body : pi.rhs;
			const ann = pi.type === "pi" ? pi.annotation : pi.lhs;
			const q = pi.type === "pi" && pi.multiplicity ? pi.multiplicity : Q.Many;

			const [ty, us] = yield* EB.check.gen(ann, NF.Type);
			const ctx = yield* V2.ask();

			const va = NF.evaluate(ctx, ty);
			const mva: NF.ModalValue = [va, q];

			const [bodyTm, [, ...bus]] = yield* V2.local(_ctx => EB.bind(_ctx, { type: "Pi", variable: v }, mva), EB.check(body, NF.Type));

			return [EB.Constructors.Pi(v, pi.icit, q, ty, bodyTm), NF.Type, Q.add(us, bus)] satisfies EB.AST;
		}),
	);
