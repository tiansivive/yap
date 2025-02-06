import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import { Patterns } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Src from "@qtt/src/index";
import * as Log from "@qtt/shared/logging";

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

			return M.tell("constraint", constraints[0]);
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
	TODO: Augment the context with the scrutinee narrowed to the pattern   
 */

let max = 0;
export const elaborate = (alts: Src.Alternative[], [scrutinee, scuty, us]: EB.AST): EB.M.Elaboration<[EB.Alternative, NF.Value, Q.Usages][]> => {
	if (alts.length > max) {
		Log.push("alternatives");
		max = alts.length;
	}

	if (alts.length === 1) {
		Log.logger.debug(Src.Alt.display(alts[0]), { alts, scrutinee, scuty, us });
	}

	const result = match(alts)
		.with([{ pattern: { type: "lit" } }], ([{ pattern, term }]) =>
			F.pipe(
				M.Do,
				M.let("patty", Patterns.infer.Lit(pattern)),
				M.let("branch", EB.infer(term)),
				M.discard(({ patty }) => M.tell("constraint", { type: "assign", left: patty[1], right: scuty })),
				M.fmap(({ branch }): [EB.Alternative, NF.Value, Q.Usages][] => [
					[EB.Constructors.Alternative({ type: "Lit", value: pattern.value }, branch[0]), branch[1], branch[2]],
				]),
			),
		)
		.with([{ pattern: { type: "var" } }], ([{ pattern, term }]) => {
			// TODO: Treat this exactly like a lambda abstraction when we allow annotations and multiplicities in patterns
			return F.pipe(
				M.Do,
				M.let("patty", Patterns.infer.Var(pattern)),
				M.discard(({ patty }) => M.tell("constraint", { type: "assign", left: patty[1], right: scuty })),
				M.bind("ctx", M.ask),
				M.chain(({ patty, ctx }) => {
					const binders = patty[3];
					const ctx_ = binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, [va, Q.Many]), ctx);
					return M.local(
						ctx_,
						M.fmap(EB.infer(term), (branch): [EB.Alternative, NF.Value, Q.Usages][] => [
							[EB.Constructors.Alternative(patty[0], branch[0]), branch[1], branch[2]],
						]),
					);
				}),
			);
		})
		.with([{ pattern: { type: "struct" } }], ([{ pattern, term }]) => {
			return F.pipe(
				M.Do,
				M.let("ctx", M.ask()),
				M.let("pat", Patterns.infer.Struct(pattern)),
				M.chain(({ pat: [pat, ty, qs, binders], ctx }) =>
					M.local(
						ctx_ => binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, [va, Q.Many]), ctx_),
						F.pipe(
							M.tell("constraint", { type: "assign", left: ty, right: scuty }),
							M.chain(_ => EB.infer(term)),
							M.fmap((branch): [EB.Alternative, NF.Value, Q.Usages][] => [[EB.Constructors.Alternative(pat, branch[0]), branch[1], branch[2]]]),
						),
					),
				),
			);
		})
		.with(
			[{ pattern: P._ }, ...P.array()],
			([pat, ...pats]) =>
				// NOTE: not using Do notation for logging purposes.
				// TODO: investigate why Do notation logs out of order
				M.chain(elaborate([pat], [scrutinee, scuty, us]), branch => M.chain(elaborate(pats, [scrutinee, scuty, us]), rest => M.of([branch, rest].flat()))),
			// F.pipe(
			// 	M.Do,
			// 	M.let("branch", elaborate([pat], [scrutinee, scuty, us])),
			// 	M.let("rest", elaborate(pats, [scrutinee, scuty, us])),
			// 	M.fmap(({ branch, rest }) => [branch, rest].flat()),
			// ),
		)
		.otherwise(([alt]) => {
			throw new Error(`Pattern Matching for ${alt.pattern.type}: Not implemented`);
		});

	return M.fmap(result, result => {
		if (alts.length === 1) {
			Log.push("result");
			Log.logger.debug(EB.Display.Alternative(result[0][0]));
			Log.logger.debug("[Type] " + NF.display(result[0][1]));
			Log.pop();
		}
		if (alts.length === max) {
			Log.pop();
			max = 0;
		}

		return result;
	});
};
