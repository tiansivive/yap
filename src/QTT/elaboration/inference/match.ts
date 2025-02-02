import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import { Patterns } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Src from "@qtt/src/index";

import * as Q from "@qtt/shared/modalities/multiplicity";

import * as F from "fp-ts/function";

import { match, P } from "ts-pattern";

type Match = Extract<Src.Term, { type: "match" }>;
export const infer = (tm: Match): EB.M.Elaboration<EB.AST> =>
	F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.let("scrutinee", EB.infer(tm.scrutinee)),
		M.bind("alternatives", ({ scrutinee }) => elaborate(tm.alternatives, scrutinee)),
		M.discard(({ alternatives: [a, ...as] }) => {
			// TODO: Also deal with Multiplicity constraints
			type Accumulator = [EB.Constraint[], NF.Value, Q.Usages];
			const start: Accumulator = [[], a[1], a[2]];
			const constraints = as.reduce(([cs, common, q], [alt, ty, us]): Accumulator => [[...cs, { type: "assign", left: ty, right: common }], ty, us], start);

			return M.tell(constraints[0]);
		}),

		M.fmap(({ alternatives, scrutinee }) => {
			// TODO: Also deal with usage semantics
			const match = EB.Constructors.Match(
				scrutinee[0],
				alternatives.map(([alt]) => alt),
			);
			const ty = alternatives[0][1];
			return [match, ty, scrutinee[2]];
		}),
	);

/**
 * 
	NOTE: This enforces that the return type of the function is the same for all branches.    
	TODO: Allow for returning a Variant type    
	TODO: Implement other pattern types    
	TODO: Augment the context with the bindings from the pattern    
	TODO: Augment the context with the scrutinee narrowed to the pattern   
 */
export const elaborate = (alts: Src.Alternative[], [scrutinee, scuty, us]: EB.AST): EB.M.Elaboration<[EB.Alternative, NF.Value, Q.Usages][]> => {
	return match(alts)
		.with([{ pattern: { type: "lit" } }], ([{ pattern, term }]) =>
			F.pipe(
				M.Do,
				M.let("patty", EB.infer(pattern)),
				M.let("branch", EB.infer(term)),
				M.discard(({ patty }) => M.tell({ type: "assign", left: patty[1], right: scuty })),
				M.fmap(({ branch }): [EB.Alternative, NF.Value, Q.Usages][] => [
					[EB.Constructors.Alternative({ type: "Lit", value: pattern.value }, branch[0]), branch[1], branch[2]],
				]),
			),
		)
		.with([{ pattern: { type: "var" } }], ([{ pattern, term }]) => {
			const meta = EB.Constructors.Var(EB.freshMeta());
			// TODO: Treat this exactly like a lambda abstraction when we allow annotations and multiplicities in patterns
			return M.chain(M.ask(), ctx => {
				const va = NF.evaluate(ctx.env, ctx.imports, meta);
				const mva: NF.ModalValue = [va, Q.Many];
				const ctx_ = EB.bind(ctx, pattern.value.value, mva);
				return M.local(
					ctx_,
					F.pipe(
						M.tell({ type: "assign", left: va, right: scuty }),
						M.chain(_ => EB.infer(term)),
						M.fmap((branch): [EB.Alternative, NF.Value, Q.Usages][] => [
							[EB.Constructors.Alternative({ type: "Var", value: pattern.value.value }, branch[0]), branch[1], branch[2]],
						]),
					),
				);
			});
		})
		.with([{ pattern: { type: "struct" } }], ([{ pattern, term }]) => {
			return F.pipe(
				M.Do,
				M.let("ctx", M.ask()),
				M.let("pat", Patterns.infer.Struct(pattern)),
				M.chain(({ pat: [pat, ty, qs, binders], ctx }) => {
					const ctx_ = binders.reduce((ctx, [name, va]) => EB.bind(ctx, name, [va, Q.Many]), ctx);
					return M.local(
						ctx_,
						F.pipe(
							M.tell({ type: "assign", left: ty, right: scuty }),
							M.chain(_ => EB.infer(term)),
							M.fmap((branch): [EB.Alternative, NF.Value, Q.Usages][] => [[EB.Constructors.Alternative(pat, branch[0]), branch[1], branch[2]]]),
						),
					);
				}),
			);
		})
		.with([{ pattern: P._ }, ...P.array()], ([pat, ...pats]) =>
			F.pipe(
				M.Do,
				M.let("branch", elaborate([pat], [scrutinee, scuty, us])),
				M.let("rest", elaborate(pats, [scrutinee, scuty, us])),
				M.fmap(({ branch, rest }) => [branch, rest].flat()),
			),
		)
		.otherwise(([alt]) => {
			throw new Error(`Pattern Matching for ${alt.pattern.type}: Not implemented`);
		});
};
