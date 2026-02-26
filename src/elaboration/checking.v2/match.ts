import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as F from "fp-ts/lib/function";
import * as Arr from "fp-ts/lib/Array";
import * as O from "fp-ts/lib/Option";
import * as Rec from "fp-ts/lib/Record";

import { match } from "ts-pattern";

import * as tmp from "./tmp";
import * as InferTmp from "../inference.v2/tmp";
import * as Match from "../inference.v2/match";

import { set, update } from "@yap/utils";

type MatchNode = CST.Types.MatchNode;
type Alternative = CST.Types.AlternativeNode;
type Typing = InferTmp.Typing;

const branches = (tm: MatchNode): [CST.Types.SyntaxNode, Alternative[]] => {
	const { subject, branch } = CST.Utils.extractFields(tm, "subject", ["branch"]);
	return [subject, branch.filter((b): b is Alternative => b.type === "alternative")];
};

/** Check match against any type.
 *  Dispatches to checkType when checking against Type,
 *  otherwise falls through to checkNarrow which narrows
 *  the scrutinee context per-pattern. */
export const check = function* (node: MatchNode, type: NF.Value): M.Gelaboration<EB.Term> {
	const elaboration = match(type)
		.with(NF.Patterns.Type, () => checkType(node, type))
		.otherwise(() => checkNarrow(node, type));
	return yield* M.pure(elaboration);
};

/** match × Type: each alternative body is checked against Type. */
const checkType = (node: MatchNode, type: NF.Value): M.Elaboration<EB.Term> =>
	M.Do(function* () {
		const [subject, alts] = branches(node);
		const typing: Typing = yield* tmp.infer(subject);

		const alternatives: [EB.Alternative, NF.Value][] = yield M.traverse(
			alts,
			Match.elaborate(typing, alt =>
				M.Do(function* () {
					const tm = yield* tmp.check(alt.bodyNode, type);
					return [tm, type] satisfies Typing;
				}),
			),
		);

		const [scrutinee] = typing;
		return EB.Constructors.Match(
			scrutinee,
			alternatives.map(([alt]) => alt),
		);
	});

/** match × _ : check each alternative body against the expected type,
 *  narrowing the scrutinee's binding in the context so that
 *  the pattern's value is visible during body elaboration. */
const checkNarrow = (node: MatchNode, type: NF.Value): M.Elaboration<EB.Term> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const [subject, alts] = branches(node);
		const typing: Typing = yield* tmp.infer(subject);
		const [scrutinee] = typing;

		const quoted = NF.quote(ctx, ctx.env.length, type);

		const narrow = (nf: NF.Value, ctx: EB.Context): EB.Context =>
			match(scrutinee)
				.with({ type: "Var", variable: { type: "Bound" } }, bound =>
					update(
						ctx,
						"env",
						F.flow(
							Arr.modifyAt<EB.Context["env"][number]>(bound.variable.index, set("nf", nf)),
							O.getOrElse(() => ctx.env),
						),
					),
				)
				.with({ type: "Var", variable: { type: "Free" } }, free =>
					update(ctx, "imports", imports =>
						F.pipe(
							imports,
							Rec.modifyAt(free.variable.name, set("0", NF.quote(ctx, ctx.env.length, nf))),
							O.getOrElse(() => imports),
						),
					),
				)
				.with({ type: "Var", variable: { type: "Label" } }, label =>
					update(ctx, "sigma", sigma =>
						F.pipe(
							sigma,
							Rec.modifyAt(label.variable.name, set("nf", nf)),
							O.getOrElse(() => sigma),
						),
					),
				)
				.otherwise(() => ctx);

		const alternatives: [EB.Alternative, NF.Value][] = yield M.traverse(
			alts,
			Match.elaborate(typing, (alt, [pat, , binders]) =>
				M.Do(function* () {
					const ctx = yield* M.ask();
					const val = NF.Pats.evaluate(pat, ctx, binders);
					const tm = yield* M.local(
						c => narrow(val, c),
						M.Do(function* () {
							const ctx = yield* M.ask();
							return yield* tmp.check(alt.bodyNode, NF.evaluate(ctx, quoted));
						}),
					);
					return [tm, type] satisfies Typing;
				}),
			),
		);

		return EB.Constructors.Match(
			scrutinee,
			alternatives.map(([alt]) => alt),
		);
	});
