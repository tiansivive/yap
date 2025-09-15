import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Lit from "@yap/shared/literals";

type Block = Extract<Src.Term, { type: "block" }>;

export const infer = (block: Block) =>
	V2.track(
		["src", block, { action: "infer", description: "Block statements" }],
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
					return yield* V2.local(
						ctx => EB.bind(ctx, { type: "Let", variable: stmt.variable }, [sty, Q.Many]),
						V2.Do(function* () {
							const [tm, ty, [vu, ...rus]] = yield* V2.pure(recurse(rest, [...results, stmt]));
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
