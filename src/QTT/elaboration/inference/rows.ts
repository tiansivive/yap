import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";

import * as NF from "@qtt/elaboration/normalization";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as Src from "@qtt/src/index";

import * as F from "fp-ts/function";
import * as R from "@qtt/shared/rows";

import { match } from "ts-pattern";

export const elaborate = (row: Src.Row): M.Elaboration<[EB.Row, NF.Row, Q.Usages]> =>
	M.chain(M.ask(), ctx =>
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
							M.discard(_ => M.tell("constraint", { type: "assign", left: _ty, right: NF.Row })),
						);
					}),
				),
			)

			.with({ type: "extension" }, ({ label, value, row }) =>
				F.pipe(
					M.Do,
					M.let("value", EB.infer(value)),
					M.let("row", elaborate(row)),
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
