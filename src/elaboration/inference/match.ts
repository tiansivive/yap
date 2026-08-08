import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import { Patterns } from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

import { match } from "ts-pattern";

import * as P from "@yap/elaboration/shared/provenance";

type Match = Extract<Src.Term, { type: "match" }>;

export const infer = (tm: Match): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: tm, metadata: { action: "infer", description: "Match" } }, function* () {
		const ctx = yield* M.reader.ask();
		const ast = yield* EB.infer(tm.scrutinee);

		const alternatives = yield* M.traverse(tm.alternatives, elaborate(ast, EB.infer));

		// Ensure all alternatives have the same type - we pick the type of the first alternative as the common type
		const common = alternatives[0][1];
		yield* M.traverse(alternatives, ([_alt, ty, _us], i) => {
			const provenance: P.Provenance[] = [
				{
					tag: "alt",
					alt: tm.alternatives[i],
					metadata: {
						action: "alternative",
						type: ty,
						motive: `attempting to unify with previous alternative of type ${NF.display(ty, ctx)}:\t${Src.Alt.display(tm.alternatives[i])}`,
					},
				},
				{ tag: "src", type: "term", term: tm.alternatives[i].term, metadata: { action: "infer", description: "" } },
			];
			return M.tracer.track(provenance, function* () {
				yield* M.constrain({ type: "assign", left: ty, right: common, lvl: ctx.env.length });
			});
		});

		// TODO: Also deal with usage semantics
		const [scrutinee, _scuty, sus] = ast;
		const match = EB.Constructors.Match(
			scrutinee,
			alternatives.map(([alt]) => alt),
		);
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const matchTy = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));

		const constraints = alternatives.map(([, ty]): EB.Constraint => ({ type: "assign", left: ty, right: matchTy, lvl: ctx.env.length }));
		yield* M.constrain(constraints);

		return [match, matchTy, sus] satisfies EB.AST;
	});

/**
 *
	TODO: Allow for returning a Variant type
	TODO: Augment the context with the scrutinee narrowed to the pattern
 */
export type AltNode = [EB.Alternative, NF.Value, Q.Usages];
export const elaborate =
	([_scrutinee, scuty, _sus]: EB.AST, action: (alt: Src.Term, pat: EB.Patterns.Result) => M.Elaboration<EB.AST>) =>
	(alt: Src.Alternative): M.Elaboration<AltNode> =>
		M.tracer.track({ tag: "alt", alt, metadata: { action: "alternative", motive: "elaborating pattern", type: scuty } }, function* () {
			const extend = (binders: Patterns.Binder[]) => (ctx_: EB.Context) =>
				binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, va), ctx_);

			const inferAltBy =
				<K extends keyof Patterns.Inference<Src.Pattern, "type">>(key: K) =>
				(alt: Src.Alternative & { pattern: Extract<Src.Pattern, { type: K }> }) =>
					(function* () {
						const inferred = yield* Patterns.infer[key](alt.pattern);
						const [pat, patty, _patus, binders] = inferred;

						const ctx = yield* M.reader.ask();
						yield* M.constrain({ type: "assign", left: patty, right: scuty, lvl: ctx.env.length });

						return yield* M.reader.local(
							extend(binders),
							(function* () {
								const [branch, branty, brus]: EB.AST = yield* action(alt.term, inferred);
								return [EB.Constructors.Alternative(pat, branch, binders), branty, brus] satisfies AltNode;
							})(),
						);
					})();

			const r = match(alt)
				.with({ pattern: { type: "lit" } }, inferAltBy("Lit"))
				.with({ pattern: { type: "var" } }, inferAltBy("Var"))
				.with({ pattern: { type: "struct" } }, inferAltBy("Struct"))
				.with({ pattern: { type: "tuple" } }, inferAltBy("Tuple"))
				.with({ pattern: { type: "variant" } }, inferAltBy("Variant"))
				.with({ pattern: { type: "list" } }, inferAltBy("List"))
				.with({ pattern: { type: "wildcard" } }, inferAltBy("Wildcard"))

				.otherwise(alt => {
					throw new Error(`Pattern Matching for ${alt.pattern.type}: Not implemented`);
				});

			return yield* r;
		});
