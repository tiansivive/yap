import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import { Patterns } from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as F from "fp-ts/function";

import { match } from "ts-pattern";

type Match = Extract<Src.Term, { type: "match" }>;

export const infer = (tm: Match): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", tm, { action: "infer", description: "Match" }],
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const ast = yield* EB.infer.gen(tm.scrutinee);
			const alternatives: AltNode[] = yield V2.traverse(tm.alternatives, elaborate(ast));

			// Ensure all alternatives have the same type - we pick the type of the first alternative as the common type
			const common = alternatives[0][1];
			yield V2.traverse(alternatives, ([alt, ty, us], i) => {
				const provenance: EB.Provenance[] = [
					[
						"alt",
						tm.alternatives[i + 1],
						{
							action: "alternative",
							type: ty,
							motive: `attempting to unify with previous alternative of type ${NF.display(ty)}:\t${Src.Alt.display(tm.alternatives[i])}`,
						},
					],
					["src", tm.alternatives[i + 1].term],
				];
				return V2.track(
					provenance,
					V2.Do(() => V2.tell("constraint", { type: "assign", left: ty, right: common, lvl: ctx.env.length })),
				);
			});

			// TODO: Also deal with usage semantics
			const [scrutinee, scuty, sus] = ast;
			const match = EB.Constructors.Match(
				scrutinee,
				alternatives.map(([alt]) => alt),
			);
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const matchTy = NF.Constructors.Var(EB.freshMeta(ctx.env.length, kind));

			const constraints = alternatives.map(([, ty]): EB.Constraint => ({ type: "assign", left: ty, right: matchTy, lvl: ctx.env.length }));
			yield* V2.tell("constraint", constraints);

			return [match, matchTy, sus] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);

/**
 * 
	TODO: Allow for returning a Variant type    
	TODO: Augment the context with the scrutinee narrowed to the pattern   
 */
type AltNode = [EB.Alternative, NF.Value, Q.Usages];
export const elaborate =
	([scrutinee, scuty, sus]: EB.AST) =>
	(alt: Src.Alternative): V2.Elaboration<AltNode> =>
		V2.track(
			["alt", alt, { action: "alternative", motive: "elaborating pattern", type: scuty }],
			(() => {
				const extend = (binders: Patterns.Binder[]) => (ctx_: EB.Context) =>
					binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, [va, Q.Many]), ctx_);

				const inferAltBy =
					<K extends keyof Patterns.Inference<Src.Pattern, "type">>(key: K) =>
					(alt: Src.Alternative & { pattern: Extract<Src.Pattern, { type: K }> }) =>
						V2.Do(function* () {
							const [pat, patty, patus, binders] = yield* Patterns.infer[key].gen(alt.pattern);
							yield* V2.tell("constraint", { type: "assign", left: patty, right: scuty });

							const node = yield* V2.local(
								extend(binders),
								V2.Do(function* () {
									const [branch, branty, brus] = yield* EB.infer.gen(alt.term);
									return [EB.Constructors.Alternative(pat, branch), branty, brus] satisfies AltNode;
								}),
							);
							return node;
						});

				const r = match(alt)
					.with({ pattern: { type: "lit" } }, inferAltBy("Lit"))
					.with({ pattern: { type: "var" } }, inferAltBy("Var"))
					.with({ pattern: { type: "struct" } }, inferAltBy("Struct"))
					.with({ pattern: { type: "variant" } }, inferAltBy("Variant"))
					.with({ pattern: { type: "list" } }, inferAltBy("List"))
					.otherwise(alt => {
						throw new Error(`Pattern Matching for ${alt.pattern.type}: Not implemented`);
					});

				return r;
			})(),
		);
