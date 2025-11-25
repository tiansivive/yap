import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/function";
import * as R from "@yap/shared/rows";

import { match } from "ts-pattern";
import { entries, setProp } from "@yap/utils";

type TRow = Extract<Src.Term, { type: "row" }>;

export const infer = (term: TRow): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term, metadata: { action: "infer", description: "Row" } },
		V2.Do(() =>
			V2.local(
				EB.muContext,
				V2.Do(function* () {
					const { fields, tail } = yield* inSigmaContext.gen(term.row, collect(term.row));

					if (tail) {
						throw new Error("Row literals with tails are not supported");
					}

					const tm = fields.reduce<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Empty());
					return [EB.Constructors.Row(tm), NF.Row, Q.noUsage(0)] satisfies EB.AST;
				}),
			),
		),
	);
infer.gen = F.flow(infer, V2.pure);

// TODO:FIXME update the sigma env to a stack of sigma records to properly handle nested row types
export const inSigmaContext = <A>(row: Src.Row, f: V2.Elaboration<A>, isAnnotation = false): V2.Elaboration<A> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const bindings = yield* extract(row, ctx.env.length);
		return yield* V2.local(ctx_ => entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv, isAnnotation), ctx_), f);
	});
inSigmaContext.gen = <A>(row: Src.Row, f: V2.Elaboration<A>, isAnnotation = false) => V2.pure(inSigmaContext(row, f, isAnnotation));

type Collected = { fields: { label: string; term: EB.Term; value: NF.Value }[]; tail?: { variable: EB.Variable; ty: NF.Value } };
export const collect = (row: Src.Row): V2.Elaboration<Collected> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();

		const initial: Collected = { fields: [] };
		const collected: Collected = yield R.fold<Src.Term, Src.Variable, V2.Elaboration<Collected>>(
			row,
			(val, lbl, acc) =>
				V2.Do(function* () {
					const [vtm, vty, qs] = yield* EB.infer.gen(val);
					const sigma = ctx.sigma[lbl];
					if (!sigma) {
						throw new Error("Elaborating Row Extension: Label not found");
					}

					const nf = NF.evaluate(ctx, vtm);
					yield* V2.tell("constraint", [
						//{ type: "assign", left: nf, right: sigma.nf },
						{ type: "assign", left: vty, right: sigma.nf },
					]);

					const accumulated: Collected = yield acc;
					return { fields: [...accumulated.fields, { label: lbl, term: vtm, value: vty }], tail: accumulated.tail };
				}),
			(v, acc) =>
				V2.Do(function* () {
					const [tm, ty, qs] = yield* EB.lookup.gen(v, ctx);
					if (tm.type !== "Var") {
						throw new Error("Elaborating Row Var: Not a variable");
					}

					const _ty = NF.unwrapNeutral(ty);

					const accumulated: Collected = yield acc;
					return { fields: accumulated.fields, tail: { variable: tm.variable, ty: _ty } };
				}),
			V2.of(initial),
		);

		return collected;
	});
collect.gen = F.flow(collect, V2.pure);

export const extract = function* (row: Src.Row, lvl: number, types?: NF.Row): Generator<V2.Elaboration<any>, Record<string, EB.Sigma>, any> {
	if (row.type === "empty") {
		return {};
	}

	if (row.type === "variable") {
		return {};
	}

	const ktm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));
	const tm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, ktm));

	//const kty = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));
	const ty = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));

	const ctx = yield* V2.ask();
	const info: EB.Sigma = { term: NF.quote(ctx, ctx.env.length, tm), nf: tm, ann: ty, multiplicity: Q.Many };

	const rest = yield* extract({ ...row.row, location: row.location }, lvl);
	return setProp(rest, row.label, info);
	// return [[row.label, [v, Q.Many]], ...extract({ ...row.row, location: row.location }, lvl + 1)]
};
