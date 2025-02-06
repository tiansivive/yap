import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as NF from "@qtt/elaboration/normalization";
import * as Src from "@qtt/src/index";

import { match } from "ts-pattern";

type Application = Extract<Src.Term, { type: "application" }>;

export const infer = ({ fn, arg, icit }: Application) =>
	F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.let("fn", M.chain(EB.infer(fn), icit === "Explicit" ? EB.Icit.insert : M.of)),
		M.bind("pi", ({ fn: [ft, fty], ctx }) =>
			match(fty)
				.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
					if (pi.binder.icit !== icit) {
						throw new Error("Implicitness mismatch");
					}

					return M.of([pi.binder.annotation, pi.closure] as const);
				})
				.otherwise(() => {
					const meta = EB.Constructors.Var(EB.freshMeta());
					const nf = NF.evaluate(ctx.env, ctx.imports, meta);
					const mnf: NF.ModalValue = [nf, Q.Many];
					const closure = NF.Constructors.Closure(ctx.env, EB.Constructors.Var(EB.freshMeta()));

					const pi = NF.Constructors.Pi("x", icit, mnf, closure);

					return F.pipe(
						M.of([mnf, closure] as const),
						M.discard(() => M.tell("constraint", { type: "assign", left: fty, right: pi })),
					);
				}),
		),
		M.bind("arg", ({ pi: [ann] }) => EB.check(arg, ann[0])),
		M.chain(({ fn: [ft, fty, fus], arg: [at, aus], pi, ctx }) => {
			const [[, q], cls] = pi;
			const rus = Q.add(fus, Q.multiply(q, aus));

			const val = NF.apply(ctx.imports, cls, NF.evaluate(ctx.env, ctx.imports, at), q);

			const ast: EB.AST = [EB.Constructors.App(icit, ft, at), val, rus];
			return M.of(ast);
		}),
	);
