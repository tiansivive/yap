import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/function";
import * as R from "@yap/shared/rows";

import * as Rec from "fp-ts/Record";

import { match } from "ts-pattern";
import { entries, setProp } from "@yap/utils";

type TRow = Extract<Src.Term, { type: "row" }>;

export const infer = ({ row }: TRow): EB.M.Elaboration<EB.AST> =>
	M.local(
		EB.muContext,
		// QUESTION:? can we do anything to the ty row? Should we?
		// SOLUTION: Rely on `check` for this behaviour. Inferring a row should just returns another row, same as the struct overloaded syntax.
		M.fmap(elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Row(row), NF.Row, qs]),
	);

export const elaborate = (_row: Src.Row): M.Elaboration<[EB.Row, NF.Row, Q.Usages]> =>
	M.chain(M.ask(), _ctx => {
		const bindings = extract(_row, _ctx.env.length);

		const _elaborate = (row: Src.Row): M.Elaboration<[EB.Row, NF.Row, Q.Usages]> => {
			return M.chain(M.ask(), ctx =>
				match(row)
					.with({ type: "empty" }, r => M.of<[EB.Row, NF.Row, Q.Usages]>([r, R.Constructors.Empty(), Q.noUsage(ctx.env.length)]))
					.with({ type: "variable" }, ({ variable }) =>
						F.pipe(
							EB.lookup(variable, ctx),
							M.chain(([tm, ty, qs]) => {
								if (tm.type !== "Var") {
									throw new Error("Elaborating Row Var: Not a variable");
								}

								const _ty = NF.unwrapNeutral(ty);
								if (_ty.type !== "Row" && _ty.type !== "Var") {
									throw new Error("Elaborating Row Var: Type not a row or var");
								}

								const ast: [EB.Row, NF.Row, Q.Usages] = [
									{ type: "variable", variable: tm.variable },
									_ty.type === "Row" ? _ty.row : { type: "variable", variable: _ty.variable },
									qs,
								];
								return F.pipe(
									M.of(ast),
									M.discard(_ => M.tell("constraint", { type: "assign", left: _ty, right: NF.Row, lvl: ctx.env.length })),
								);
							}),
						),
					)

					.with({ type: "extension" }, ({ label, value, row }) =>
						F.pipe(
							M.Do,
							M.let("value", EB.infer(value)),
							M.discard(({ value: [tm, ty] }) => {
								const sigma = bindings[label];

								if (!sigma) {
									throw new Error("Elaborating Row Extension: Label not found");
								}

								const nf = NF.evaluate(ctx, tm);
								return M.tell("constraint", [
									{ type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
									{ type: "assign", left: ty, right: sigma.ann, lvl: ctx.env.length },
								]);
							}),
							M.let("row", _elaborate(row as Src.Row)),
							M.fmap(({ value, row }): [EB.Row, NF.Row, Q.Usages] => {
								const q = Q.add(value[2], row[2]);
								const ty = NF.Constructors.Extension(label, value[1], row[1]);
								const tm = EB.Constructors.Extension(label, value[0], row[0]);
								return [tm, ty, q];
							}),
						),
					)
					.exhaustive(),
			);
		};

		const extended = entries(bindings).reduce((ctx, [label, mv]) => EB.extendSigma(ctx, label, mv), _ctx);
		return F.pipe(
			M.local(extended, _elaborate(_row)),
			// M.discard(([r]) => {
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
			// })
		);
	});

export const extract = (row: Src.Row, lvl: number, types?: NF.Row): Record<string, EB.Sigma> => {
	if (row.type === "empty") {
		return {};
	}

	if (row.type === "variable") {
		return {};
	}

	const ktm = NF.Constructors.Var(EB.freshMeta(lvl, NF.Type));
	const tm = NF.Constructors.Var(EB.freshMeta(lvl, ktm));

	const kty = NF.Constructors.Var(EB.freshMeta(lvl, NF.Type));
	const ty = NF.Constructors.Var(EB.freshMeta(lvl, kty));
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
