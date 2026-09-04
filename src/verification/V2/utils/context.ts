import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import { match } from "ts-pattern";

import * as Err from "@yap/elaboration/shared/errors";

import { reader, fail, type Verification } from "../effects";

export const noCapture = (ctx: EB.Context): EB.Context => ({ ...ctx, env: [] });

type LabelBindings = { labels: EB.Context["labels"]; sigma: EB.Context["sigma"] };

export const collectSigmaBindings = function* (r1: NF.Row, r2: NF.Row): Verification<LabelBindings> {
	return yield* match<[NF.Row, NF.Row], Verification<LabelBindings>>([r1, r2])
		.with([{ type: "empty" }, { type: "empty" }], function* () {
			return { labels: {}, sigma: {} };
		})
		.with([{ type: "empty" }, { type: "variable" }], function* () {
			return { labels: {}, sigma: {} };
		})
		.with([{ type: "extension" }, { type: "extension" }], function* ([{ label, value, row }, r]) {
			const rewritten = R.rewrite(r, label);
			if (E.isLeft(rewritten)) {
				return yield* fail(Err.MissingLabel(label, r));
			}
			if (rewritten.right.type !== "extension") {
				return yield* fail({ type: "Impossible", message: "Row rewrite must yield extension" });
			}
			const acc = yield* collectSigmaBindings(row, rewritten.right.row);
			return {
				labels: { ...acc.labels, [label]: rewritten.right.value },
				sigma: { ...acc.sigma, [label]: { value } },
			};
		})
		.otherwise(function* () {
			return yield* fail({ type: "Impossible", message: "Schema verification: incompatible rows" });
		});
};

const rowFieldTypes = (row: NF.Row): EB.Context["labels"] =>
	match(row)
		.with({ type: "extension" }, ({ label, value, row }) => ({ [label]: value, ...rowFieldTypes(row) }))
		.otherwise(() => ({}));

/**
 * Establish the sibling-label scope for a record/sigma row before descending into its subterms.
 * Each field label becomes visible — its declared type in `labels`, a symbolic label-neutral in
 * `sigma` — so any subterm referencing a sibling `:field` resolves (NbE reads `sigma`; the IVL
 * translator reads `labels` for the sort). Verification analogue of elaboration's `withLabelContext`.
 */
export const withRowLabels = function* <A>(row: NF.Row, comp: Verification<A>): Verification<A> {
	const labels = rowFieldTypes(row);
	return yield* reader.local(ctx => {
		const sigma = Object.keys(labels).reduce<EB.Context["sigma"]>(
			(s, label) => ({ ...s, [label]: { value: NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label })) } }),
			ctx.sigma,
		);
		return { ...ctx, labels: { ...ctx.labels, ...labels }, sigma };
	}, comp);
};

export const unwrapExistential = (nf: NF.Value): NF.Value =>
	match(NF.unwrapNeutral(nf))
		.with({ type: "Existential" }, e => unwrapExistential(e.body.value))
		.otherwise(() => nf);
