import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as NF from "@qtt/elaboration/normalization";
import * as Src from "@qtt/src/index";

import * as Log from "@qtt/shared/logging";

type Lambda = Extract<Src.Term, { type: "lambda" }>;

export const infer = (lam: Lambda): EB.M.Elaboration<EB.AST> => {
	Log.push("lambda");
	Log.logger.debug(Src.display(lam));
	return F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.bind("ann", ({ ctx }) => {
			const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length));
			return lam.annotation ? EB.check(lam.annotation, NF.Type) : M.of([meta, Q.noUsage(ctx.env.length)] as const);
		}),
		M.chain(({ ann: [tm], ctx }) => {
			const va = NF.evaluate(ctx.env, ctx.imports, tm);
			const mva: NF.ModalValue = [va, lam.multiplicity ? lam.multiplicity : Q.Many];
			const ctx_ = EB.bind(ctx, { type: "Lambda", variable: lam.variable }, mva);
			return M.local(
				ctx_,
				F.pipe(
					EB.infer(lam.body),
					M.chain(EB.Icit.insert),
					M.discard(([, , [vu]]) => M.tell("constraint", { type: "usage", expected: mva[1], computed: vu })),
					M.fmap(([bTerm, bType, [vu, ...us]]): EB.AST => {
						const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm);
						const pi = NF.Constructors.Pi(lam.variable, lam.icit, mva, NF.closeVal(ctx, bType));

						return [tm, pi, us]; // Remove the usage of the bound variable
					}),
				),
			);
		}),
		M.discard(() => {
			Log.pop();
			return M.of(null);
		}),
	);
};
