import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Lit from "@yap/shared/literals";
import { Liquid } from "@yap/verification/modalities";

import * as Sub from "@yap/elaboration/unification/substitution";

type Block = Extract<Src.Term, { type: "block" }>;

export const infer = (block: Block) =>
	V2.track(
		{ tag: "src", type: "term", term: block, metadata: { action: "infer", description: "Block statements" } },
		(() => {
			const { statements, return: ret } = block;
			const recurse = (stmts: Src.Statement[], results: EB.Statement[]): V2.Elaboration<EB.AST> =>
				V2.Do(function* () {
					if (stmts.length === 0) {
						return yield* inferReturn(block, results);
					}

					const [current, ...rest] = stmts;
					const [stmt, sty, sus] = yield* EB.Stmt.infer.gen(current);

					if (stmt.type !== "Let") {
						return yield* V2.pure(recurse(rest, [...results, stmt]));
					}

					const [r, next] = yield* EB.Stmt.letdec(stmt);
					yield* V2.tell("zonker", next.zonker);

					// const ctx = yield* V2.ask();
					// const { zonker, metas, constraints } = yield* V2.listen();

					// Debugging info
					// console.log("LET BINDING");
					// console.log("ZONKER:\n", Sub.display(zonker, metas));
					// console.log("\n\nTERM:\n", EB.Display.Statement(r, { ...ctx, zonker: Sub.empty, metas }));
					// console.log("\nInferred type:\n", NF.display(sty, { ...ctx, zonker: Sub.empty, metas }));

					// console.log("\n\nCONSTRAINTS:");
					// constraints.forEach(c => {
					// 	console.log("--------------------");
					// 	console.log(EB.Display.Constraint(c, { ...ctx, zonker: Sub.empty, metas}).replace(" ~~ ", "\n"));
					// });

					return yield* V2.local(
						_ => EB.bind(next, { type: "Let", variable: stmt.variable }, r.annotation),
						V2.Do(function* () {
							const [tm, ty, [vu, ...rus]] = yield* V2.pure(recurse(rest, [...results, r]));
							yield* V2.tell("constraint", { type: "usage", expected: Q.Many, computed: vu });
							// Remove the usage of the bound variable (same as the lambda rule)
							// Multiply the usages of the let binder by the multiplicity of the new let binding (same as the application rule)
							return [tm, ty, Q.add(rus, Q.multiply(Q.Many, sus))] as EB.AST;
						}),
					);
				});

			return recurse(statements, []);
		})(),
	);

const inferReturn = function* ({ return: ret }: Block, results: EB.Statement[]) {
	if (!ret) {
		//TODO: add effect tracking
		const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
		const unit = EB.Constructors.Lit(Lit.Atom("unit"));
		const tm = EB.Constructors.Block(results, unit);
		const { env } = yield* V2.ask();
		return [tm, ty, Q.noUsage(env.length)] satisfies EB.AST;
	}

	const [t, ty, rus] = yield* EB.infer.gen(ret);
	return [EB.Constructors.Block(results, t), ty, rus] satisfies EB.AST;
};

infer.gen = F.flow(infer, V2.pure);
