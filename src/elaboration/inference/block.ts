import * as A from "fp-ts/lib/Array";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";

import * as Src from "@yap/src/index";

import * as Lit from "@yap/shared/literals";

import { update } from "@yap/utils";

type Block = Extract<Src.Term, { type: "block" }>;

export const infer = (block: Block): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: block, metadata: { action: "infer", description: "Block statements" } }, () => {
		const { statements } = block;

		const recurse = function* (stmts: Src.Statement[], results: EB.Statement[]): M.Elaboration<EB.AST> {
			if (stmts.length === 0) {
				return yield* inferReturn(block, results);
			}

			const [current, ...rest] = stmts;

			/*
			 * A statement's constraints are its own. letdec solves what this statement told,
			 * not everything the block has told so far — re-solving an earlier statement's
			 * constraints would re-resolve metas that its generalization has since bound to
			 * telescope levels, against the spines those values were built on. v2 got the
			 * scope from listen; peek would hand over the whole block.
			 *
			 * The wrapper exists only to keep infer and letdec in one scope — letdec reads
			 * its constraints with peek, so the caller has to bracket both. That belongs in
			 * the let rule itself: z-yap/zettels/letdec-boundary-split.md.
			 */
			const [[stmt, sus, declared]] = yield* M.writer.listen(
				(function* () {
					const [elaborated, , usages] = yield* EB.Stmt.infer(current);

					return [elaborated, usages, elaborated.type === "Let" ? yield* EB.Stmt.letdec(elaborated) : undefined] as const;
				})(),
			);

			if (stmt.type === "Using") {
				type Implicit = EB.Context["implicits"][0];
				const nfValue = yield* NF.normalize(stmt.value, { noInlineBindings: true });

				return yield* M.reader.local(ctx => update(ctx, "implicits", A.append<Implicit>([nfValue, stmt.annotation])), recurse(rest, [...results, stmt]));
			}

			if (!declared) {
				return yield* recurse(rest, [...results, stmt]);
			}

			const [r, next] = declared;

			// First evaluate the current let body in a context extended with itself, allowing for recursion
			// Then extend the context for the remaining statements with the evaluated let binding
			const recursiveCtx = EB.bind(next, { type: "Let", variable: r.variable }, r.annotation);
			const nf = yield* M.reader.local(_ => recursiveCtx, NF.normalize(r.value));

			return yield* M.reader.local(
				_ => {
					const entry: EB.Context["env"][number] = {
						nf,
						type: [{ type: "Let", variable: r.variable }, "source", r.annotation],
						name: { type: "Let", variable: r.variable },
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

	/* The return's own constraints, for the same reason the statements scope theirs. */
	const [[t, ty, rus], { constraints }] = yield* M.writer.listen(EB.infer(ret));

	const { resolutions } = yield* EB.solve(constraints);
	const value = yield* NF.normalize(t, { noInlineBindings: true });
	const forced = yield* NF.force(ty);
	const generalized = yield* NF.abstract(forced, value, resolutions);

	return [EB.Constructors.Block(results, generalized.term), generalized.type, rus] satisfies EB.AST;
};
