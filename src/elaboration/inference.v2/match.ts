import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";


import * as tmp from "./tmp";

import * as P from "@yap/elaboration/shared/provenance";

import * as F from "fp-ts/lib/function";
import { match } from "ts-pattern";
import { SyntaxType } from "@yap/cst/types/generated";

type Match = Extract<CST.Types.SyntaxNode, { type: "match" }>;
type Alternative = Extract<CST.Types.SyntaxNode, { type: "alternative" }>;
type AltTyping = [EB.Alternative, NF.Value];

export const infer = (tm: Match): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: tm, metadata: { action: "infer", description: "Match" } },
		M.Do(function* () {
			const ctx = yield* M.ask();

			const { subject, branch } = CST.Utils.extractFields(tm, "subject", ["branch"]);

			const branches = branch.filter((b): b is Alternative => b.type === "alternative") // FIXME: Find a better way to type this. The filter is unneeded iteration

			const typing = yield* tmp.infer(subject);
			const alternatives: AltTyping[] = yield M.traverse(
				branches,
				elaborate(typing, t => M.Do(() => tmp.infer(t)))
			);

			// Ensure all alternatives have the same type - we pick the type of the first alternative as the common type
			const common = alternatives[0][1];
			yield M.traverse(alternatives, ([alt, ty], i) => {
				const provenance: P.Provenance[] = [
					{
						tag: "alt-ts",
						alt: branches[i],
						metadata: {
							action: "alternative",
							type: ty,
							motive: `attempting to unify with previous alternative of type ${NF.display(ty, ctx)}:\t${branches[i].text}`,
						},
					},
					{ tag: "src", type: "ts-node", node: branches[i].childForFieldName("body")!, metadata: { action: "infer", description: "" } },
				];
				return M.track(
					provenance,
					M.Do(() => M.tell("constraint", { type: "assign", left: ty, right: common, lvl: ctx.env.length })),
				);
			});

			// TODO: Also deal with usage semantics
			const [scrutinee, scuty] = typing;
			const match = EB.Constructors.Match(
				scrutinee,
				alternatives.map(([alt]) => alt),
			);
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const matchTy = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));

			const constraints = alternatives.map(([, ty]): EB.Constraint => ({ type: "assign", left: ty, right: matchTy, lvl: ctx.env.length }));
			yield* M.tell("constraint", constraints);

			return [match, matchTy] satisfies tmp.Typing;
		}),
	);
infer.gen = F.flow(infer, M.pure);

/**
 * 
	TODO: Allow for returning a Variant type    
	TODO: Augment the context with the scrutinee narrowed to the pattern   
 */

export const elaborate =
	([scrutinee, scuty]: tmp.Typing, action: (alt: CST.Types.AlternativeNode, pat: tmp.Patterns.Result) => M.Elaboration<tmp.Typing>) =>
		(alt: CST.Types.AlternativeNode): M.Elaboration<AltTyping> =>
			M.track(
				{ tag: "alt-ts", alt, metadata: { action: "alternative", motive: "elaborating pattern", type: scuty } },
				(() => {
					const extend = (binders: EB.Patterns.Binder[]) => (ctx_: EB.Context) =>
						binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, va), ctx_);

					const inferAltBy =
						<K extends keyof tmp.Patterns.Inference<CST.Types.PatternNode, "type">>(key: K) =>
							(pattern: Extract<CST.Types.PatternNode, { type: K }>) =>
								M.Do(function* () {
									const inferred = yield* tmp.Patterns.infer[key].gen(pattern) // .Patterns.infer[key].gen(alt.pattern);
									const [pat, patty, binders] = inferred;
									yield* M.tell("constraint", { type: "assign", left: patty, right: scuty });

									const node = yield* M.local(
										extend(binders),
										M.Do(function* () {
											const [branch, branty]: tmp.Typing = yield action(alt, inferred);
											return [EB.Constructors.Alternative(pat, branch, binders), branty] satisfies AltTyping;
										}),
									);
									return node;
								});

	
					const { pattern } = CST.Utils.extractFields(alt, "pattern");

					const r = match(pattern)
						.with({ type: SyntaxType.Literal }, inferAltBy("Literal"))
						.with({ type: SyntaxType.Identifier }, inferAltBy("Identifier"))
						.with({ type: SyntaxType.PatternStruct }, inferAltBy("Struct"))
						.with({ type: SyntaxType.PatternTuple }, inferAltBy("Tuple"))
						.with({ type: SyntaxType.PatternTagged }, inferAltBy("Tagged"))
						.with({ type: SyntaxType.PatternList }, inferAltBy("List"))
						.with({ type: SyntaxType.Wildcard }, inferAltBy("Wildcard"))

						.otherwise(alt => {
							throw new Error(`Pattern Matching for ${pattern.type}: Not implemented`);
						});

					return r;
				})(),
			);
