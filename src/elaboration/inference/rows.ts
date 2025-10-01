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
					const [r, ty, qs] = yield* resolveSigmas.gen(term.row);
					return [EB.Constructors.Row(r), NF.Row, qs] satisfies EB.AST;
				}),
			),
		),
	);
infer.gen = F.flow(infer, V2.pure);

export const resolveSigmas = (row: Src.Row): V2.Elaboration<[EB.Row, NF.Row, Q.Usages]> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const bindings = yield* extract(row, ctx.env.length);
		const r = yield* V2.local(
			ctx_ => entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), ctx_),
			V2.Do(() => elaborate.gen(row, bindings)),
		);
		// 	// TODO:FIXME update the env, we dont hava the label values in the sigma env, only the types. The below won't work
		// 	// SOLUTION:
		// 	// 1. update the sigma env to be [EB.Term, NF.Value].
		// 	// 2. Start by extracting the labels and assigning 2 metas: one for the term and one for the value
		// 	// 3. Elaborate the row under the new context
		// 	// 		- Evaluating a label results in the corresponding meta
		// 	// 4. After inferring a row extension's term, evaluate it.
		// 	// 5. Emit a constraint equaling the sigma's term meta to the evaluated term
		// 	const dict = Rec.Functor.map(collect(r), tm => NF.evaluate(extended, tm));
		// 	return M.tell("constraint", { type: "sigma", lvl: extended.env.length, dict })
		return r;
	});
resolveSigmas.gen = F.flow(resolveSigmas, V2.pure);

type Result = [EB.Row, NF.Row, Q.Usages];
const elaborate = (row: Src.Row, bindings: Record<string, EB.Sigma>): V2.Elaboration<Result> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const m = match(row)
			.with({ type: "empty" }, r => V2.of<Result>([r, R.Constructors.Empty(), Q.noUsage(ctx.env.length)]))
			.with({ type: "variable" }, ({ variable }) =>
				V2.Do(function* () {
					const [tm, ty, qs] = yield* EB.lookup.gen(variable, ctx);
					if (tm.type !== "Var") {
						throw new Error("Elaborating Row Var: Not a variable");
					}

					const _ty = NF.unwrapNeutral(ty);
					if (_ty.type !== "Row" && _ty.type !== "Var") {
						throw new Error("Elaborating Row Var: Type not a row or var");
					}

					yield* V2.tell("constraint", { type: "assign", left: _ty, right: NF.Row });
					const ast: Result = [{ type: "variable", variable: tm.variable }, _ty.type === "Row" ? _ty.row : { type: "variable", variable: _ty.variable }, qs];
					return ast;
				}),
			)
			.with({ type: "extension" }, ({ label, value, row }) =>
				V2.Do(function* () {
					const [vtm, vty, qs] = yield* EB.infer.gen(value);
					const sigma = bindings[label];
					if (!sigma) {
						throw new Error("Elaborating Row Extension: Label not found");
					}

					const nf = NF.evaluate(ctx, vtm);
					yield* V2.tell("constraint", [
						{ type: "assign", left: nf, right: sigma.nf },
						{ type: "assign", left: vty, right: sigma.ann },
					]);
					const [r, rty, rus] = yield* elaborate.gen(row as Src.Row, bindings);
					const q = Q.add(qs, rus);
					const ty = NF.Constructors.Extension(label, vty, rty);
					const tm = EB.Constructors.Extension(label, vtm, r);
					return [tm, ty, q] satisfies Result;
				}),
			)
			.exhaustive();

		const r: Result = yield m;
		return r;
	});
elaborate.gen = F.flow(elaborate, V2.pure);

export const extract = function* (row: Src.Row, lvl: number, types?: NF.Row): Generator<V2.Elaboration<any>, Record<string, EB.Sigma>, any> {
	if (row.type === "empty") {
		return {};
	}

	if (row.type === "variable") {
		return {};
	}

	const ktm = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
	const tm = NF.Constructors.Var(yield* EB.freshMeta(lvl, ktm));

	const kty = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
	const ty = NF.Constructors.Var(yield* EB.freshMeta(lvl, kty));
	const info: EB.Sigma = { nf: tm, ann: ty, multiplicity: Q.Many };

	const rest = extract({ ...row.row, location: row.location }, lvl + 1);
	return setProp(rest, row.label, info);
	// return [[row.label, [v, Q.Many]], ...extract({ ...row.row, location: row.location }, lvl + 1)]
};

export const collect = (row: EB.Row): Record<string, EB.Term> => {
	if (row.type === "empty") {
		return {};
	}

	if (row.type === "variable") {
		return {};
	}

	const r = collect(row.row);
	return setProp(r, row.label, row.value);
};
