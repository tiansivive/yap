import * as A from "fp-ts/lib/Array";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";

import * as Src from "@yap/src/index";

import * as Lit from "@yap/shared/literals";

import { update } from "@yap/utils";
import { compose } from "../unification/substitution";

type Block = Extract<Src.Term, { type: "block" }>;

export const infer = (block: Block): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: block, metadata: { action: "infer", description: "Block statements" } }, () => {
		const { statements } = block;

		const recurse = function* (stmts: Src.Statement[], results: EB.Statement[]): M.Elaboration<EB.AST> {
			if (stmts.length === 0) {
				return yield* inferReturn(block, results);
			}

			const [current, ...rest] = stmts;
			const [stmt, _sty, sus] = yield* EB.Stmt.infer(current);

			if (stmt.type === "Using") {
				type Implicit = EB.Context["implicits"][0];
				return yield* M.reader.local(
					ctx => update(ctx, "implicits", A.append<Implicit>([NF.evaluate(ctx, stmt.value, { noInlineBindings: true }), stmt.annotation])),
					recurse(rest, [...results, stmt]),
				);
			}

			if (stmt.type !== "Let") {
				return yield* recurse(rest, [...results, stmt]);
			}

			const [r, next] = yield* EB.Stmt.letdec(stmt);
			yield* M.st.modify(s => ({ ...s, registry: Metas.withSolutions(s.registry, next.zonker) }));

			return yield* M.reader.local(
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
				(function* () {
					const [tm, ty, [_vu, ...rus]] = yield* recurse(rest, [...results, r]);
					// yield* M.constrain({ type: "usage", expected: Q.Many, computed: vu });
					// Remove the usage of the bound variable (same as the lambda rule)
					// Multiply the usages of the let binder by the multiplicity of the new let binding (same as the application rule)
					return [tm, ty, Q.add(rus, Q.multiply(Q.Many, sus))] satisfies EB.AST;
				})(),
			);
		};

		return recurse(statements, []);
	});

const inferReturn = function* ({ return: ret }: Block, results: EB.Statement[]): M.Elaboration<EB.AST> {
	if (!ret) {
		//TODO: add effect tracking
		const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
		const unit = EB.Constructors.Lit(Lit.unit());
		const tm = EB.Constructors.Block(results, unit);
		const { env } = yield* M.reader.ask();
		return [tm, ty, Q.noUsage(env.length)] satisfies EB.AST;
	}

	const [t, ty, rus] = yield* EB.infer(ret);

	const ctx = yield* M.reader.ask();
	const { constraints } = yield* M.writer.peek();
	const { registry } = yield* M.st.get();
	const withMetas = update(ctx, "metas", prev => ({ ...prev, ...Metas.asContext(ctx, registry) }));

	const { zonker, resolutions } = yield* M.reader.local(_ => withMetas, EB.solve(constraints));
	const { registry: postSolve } = yield* M.st.get();

	const withAllMetas = update(withMetas, "metas", prev => ({ ...prev, ...Metas.asContext(ctx, postSolve) }));
	const zonked = update(withAllMetas, "zonker", z => compose(zonker, z));
	const value = NF.evaluate(zonked, t, { noInlineBindings: true });
	const generalized = NF.abstract(NF.force(zonked, ty), value, zonked, resolutions);
	yield* M.st.modify(s => ({ ...s, registry: Metas.withSolutions(s.registry, generalized.zonker) }));

	return [EB.Constructors.Block(results, generalized.term), generalized.type, rus] satisfies EB.AST;
};
