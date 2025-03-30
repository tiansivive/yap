import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = ({ fn, arg, icit }: Application) => {
	return F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.let(
			"fn",
			M.track(["src", fn, { action: "infer", description: "inferring function type" }], M.chain(EB.infer(fn), icit === "Explicit" ? EB.Icit.insert : M.of)),
		),
		M.bind("pi", ({ fn: [ft, fty], ctx }) => {
			return match(fty)
				.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
					if (pi.binder.icit !== icit) {
						throw new Error("Implicitness mismatch");
					}

					return M.of([pi.binder.annotation, pi.closure, pi.binder.variable] as const);
				})
				.otherwise(() => {
					const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length));
					const nf = NF.evaluate(ctx, meta);
					const mnf: NF.ModalValue = [nf, Q.Many];
					const closure = NF.Constructors.Closure(ctx.env, EB.Constructors.Var(EB.freshMeta(ctx.env.length + 1)));

					const pi = NF.Constructors.Pi("x", icit, mnf, closure);

					return F.pipe(
						M.of([mnf, closure, pi.binder.variable] as const),
						M.discard(() => M.tell("constraint", { type: "assign", left: fty, right: pi, lvl: ctx.env.length })),
					);
				});
		}),
		M.bind("arg", ({ pi: [ann] }) =>
			M.track(["src", arg, { action: "checking", against: ann[0], description: "checking fn argument arg against its annotation" }], EB.check(arg, ann[0])),
		),
		M.chain(({ fn: [ft, fty, fus], arg: [at, aus], pi, ctx }) => {
			const [[, q], cls, x] = pi;
			const rus = Q.add(fus, Q.multiply(q, aus));

			const val = NF.apply(ctx, { type: "Pi", variable: x }, cls, NF.evaluate(ctx, at), q);

			const ast: EB.AST = [EB.Constructors.App(icit, ft, at), val, rus];
			return M.of(ast);
		}),
	);
};
