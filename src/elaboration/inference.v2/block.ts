import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";

import * as F from "fp-ts/lib/function";
import * as Lit from "@yap/shared/literals";
import { update } from "@yap/utils";

type Block = Extract<CST.Types.SyntaxNode, { type: "block" }>;
type Stmt = CST.Types.SyntaxNode;
type Return = Extract<CST.Types.SyntaxNode, { type: "return_statement" }>;

export const infer = (node: Block) =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Block statements" } },
		(() => {
			const { statement, return: ret } = CST.Utils.extractFields(node, "return", ["statement"]);

			const recurse = (stmts: Stmt[], results: EB.Statement[]): M.Elaboration<tmp.Typing> =>
				M.Do(function* () {
					if (stmts.length === 0) {
						return yield* inferReturn(ret as Return, results);
					}

					const [current, ...rest] = stmts;
					const [stmt, sty] = yield* tmp.Stmt.infer(current);

					if (stmt.type !== "Let") {
						return yield* M.pure(recurse(rest, [...results, stmt]));
					}

					const [r, next] = yield* EB.Stmt.letdec(stmt);
					yield* M.tell("zonker", next.zonker);

					return yield* M.local(
						_ => {
							// First evaluate the current let body in a context extended with itself, allowing for recursion
							// Then extend the context for the remaining statements with the evaluated let binding
							const recursiveCtx = EB.bind(next, { type: "Let", variable: stmt.variable }, r.annotation);
							const entry: EB.Context["env"][number] = {
								nf: NF.evaluate(recursiveCtx, r.value),
								type: [{ type: "Let", variable: stmt.variable }, "source", r.annotation],
								name: { type: "Let", variable: stmt.variable },
							};
							return update(next, "env", env => [entry, ...env]);
						},
						M.Do(function* () {
							const [tm, ty] = yield* M.pure(recurse(rest, [...results, r]));
							// yield* M.tell("constraint", { type: "usage", expected: Q.Many, computed: vu });
							// Remove the usage of the bound variable (same as the lambda rule)
							// Multiply the usages of the let binder by the multiplicity of the new let binding (same as the application rule)
							return [tm, ty] as tmp.Typing as any;
						}),
					);
				});

			return recurse(statement as Stmt[], []);
		})(),
	);

const inferReturn = function* (node: Return | undefined, results: EB.Statement[]) {
	if (!node) {
		//TODO: add effect tracking
		const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
		const unit = EB.Constructors.Lit(Lit.unit());
		const tm = EB.Constructors.Block(results, unit);
		const { env } = yield* M.ask();
		return [tm, ty] satisfies tmp.Typing;
	}

	const [t, ty] = yield* tmp.infer(node);
	return [EB.Constructors.Block(results, t), ty] satisfies tmp.Typing;
};

infer.gen = F.flow(infer, M.pure);
