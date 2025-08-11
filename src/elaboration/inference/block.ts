import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Lit from "@yap/shared/literals";

type Block = Extract<Src.Term, { type: "block" }>;

export const infer = ({ statements, return: ret }: Block) => {
	const recurse = (stmts: Src.Statement[], ctx: EB.Context, results: EB.Statement[]): M.Elaboration<EB.AST> => {
		if (stmts.length === 0) {
			if (!ret) {
				//TODO: add effect tracking
				const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
				const unit = EB.Constructors.Lit(Lit.Atom("unit"));
				const tm = EB.Constructors.Block(results, unit);
				return M.of<EB.AST>([tm, ty, Q.noUsage(ctx.env.length)]);
			}
			return M.local(
				ctx,
				F.pipe(
					EB.infer(ret),
					M.fmap(([ret, ty, rus]): EB.AST => {
						return [EB.Constructors.Block(results, ret), ty, rus];
					}),
				),
			);
		}

		const [stmt, ...rest] = stmts;
		return M.local(
			ctx,
			F.pipe(
				M.Do,
				M.let("stmt", EB.Stmt.infer(stmt)),
				M.bind("block", ({ stmt }) => {
					const [s, ty, bus] = stmt;

					if (s.type !== "Let") {
						return recurse(rest, ctx, [...results, s]);
					} // Add effect tracking here // Add effect tracking here

					const extended = EB.bind(ctx, { type: "Let", variable: s.variable }, [ty, Q.Many]);
					return F.pipe(
						recurse(rest, extended, [...results, s]),
						M.discard(([, , [vu]]) => M.tell("constraint", { type: "usage", expected: Q.Many, computed: vu })),
						//M.fmap(([tm, ty, us]): EB.AST => [tm, ty, Q.multiply(Q.Many, us)]),
						// Remove the usage of the bound variable (same as the lambda rule)
						// Multiply the usages of the let binder by the multiplicity of the new let binding (same as the application rule)
						M.fmap(([tm, ty, [vu, ...rus]]): EB.AST => [tm, ty, Q.add(rus, Q.multiply(Q.Many, bus))]),
					);
				}),
				M.fmap(({ stmt: [, , us], block: [tm, typ, usages] }) => {
					return [tm, typ, usages];
				}),
			),
		);
	};
	return M.chain(M.ask(), ctx => recurse(statements, ctx, []));
};
