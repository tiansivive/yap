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
				const nfValue = yield* NF.normalize(stmt.value, { noInlineBindings: true });

				return yield* M.reader.local(ctx => update(ctx, "implicits", A.append<Implicit>([nfValue, stmt.annotation])), recurse(rest, [...results, stmt]));
			}

			if (stmt.type !== "Let") {
				return yield* recurse(rest, [...results, stmt]);
			}

			const [r, next] = yield* EB.Stmt.letdec(stmt);

			// First evaluate the current let body in a context extended with itself, allowing for recursion
			// Then extend the context for the remaining statements with the evaluated let binding
			const recursiveCtx = EB.bind(next, { type: "Let", variable: stmt.variable }, r.annotation);
			const nf = yield* M.reader.local(_ => recursiveCtx, NF.normalize(r.value));

			return yield* M.reader.local(
				_ => {
					const entry: EB.Context["env"][number] = {
						nf,
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
	const registry = yield* Metas.registry.get();
	const metas = yield* Metas.asContext(registry);
	const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));

	const { resolutions } = yield* M.reader.local(_ => withMetas, EB.solve(constraints));
	// The solver commits its solutions; the v2-view fields are rebuilt from the registry until context surgery.
	const postSolve = yield* Metas.registry.get();

	const postMetas = yield* Metas.asContext(postSolve);
	const withAllMetas = update(withMetas, "metas", prev => ({ ...prev, ...postMetas }));
	const zonked = update(withAllMetas, "zonker", z => compose(Metas.solutions(postSolve), z));
	const value = yield* M.reader.local(_ => zonked, NF.normalize(t, { noInlineBindings: true }));
	const forced = yield* M.reader.local(_ => zonked, NF.force(ty));
	const generalized = yield* M.reader.local(_ => zonked, NF.abstract(forced, value, resolutions));

	return [EB.Constructors.Block(results, generalized.term), generalized.type, rus] satisfies EB.AST;
};
