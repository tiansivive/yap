import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import { match } from "ts-pattern";

import * as Err from "@yap/elaboration/shared/errors";

import type { IVL } from "../../solver/ivl/types";
import type { Obligation, VerificationServiceOptions } from "../types";

export type VerificationRuntime = {
	log: (...msgs: string[]) => void;
	enter: () => void;
	exit: () => void;
	record: (label: string, expr: IVL.Formula, context?: Obligation["context"]) => IVL.Formula;
	freshName: () => string;
	getObligations: () => Obligation[];
};

export const createRuntime = ({ logging = false }: VerificationServiceOptions = {}): VerificationRuntime => {
	let indentation = 0;
	let freshSeq = "a";
	const obligations: Obligation[] = [];

	const prefix = (track: boolean = true) => `${track ? "|" : " "}\t`.repeat(indentation);

	const log = (...msgs: string[]) => {
		if (!logging) {
			return;
		}
		console.log(prefix() + msgs.join("\n" + prefix(false)));
	};

	const bumpAlpha = (s: string): string => {
		let carry = 1;
		let res = "";
		for (let i = s.length - 1; i >= 0; i--) {
			const v = s.charCodeAt(i) - 97 + carry;
			if (v >= 26) {
				res = "a" + res;
				carry = 1;
			} else {
				res = String.fromCharCode(97 + v) + res;
				carry = 0;
			}
		}
		if (carry) {
			res = "a" + res;
		}
		return res;
	};

	const freshName = () => {
		const name = `$${freshSeq}`;
		freshSeq = bumpAlpha(freshSeq);
		return name;
	};

	const record: VerificationRuntime["record"] = (label, expr, context) => {
		obligations.push({ label, expr, context });
		return expr;
	};

	const enter = () => {
		indentation++;
	};

	const exit = () => {
		indentation = Math.max(0, indentation - 1);
	};

	const getObligations = () => obligations.slice();

	return { log, enter, exit, record, freshName, getObligations };
};

export const noCapture = (ctx: EB.Context): EB.Context => ({ ...ctx, env: [] });

export const extendContext = (context: EB.Context, binder: EB.Binder, value: NF.Value, ann: NF.Value): EB.Context => {
	const { env } = context;
	const entry: EB.Context["env"][number] = {
		nf: value,
		type: [binder, "source", ann],
		name: binder,
	};
	return {
		...context,
		env: [entry, ...env],
	};
};

export const applyClosure = (binder: EB.Binder, closure: NF.Closure, value: NF.Value, ann: NF.Value): NF.Value => {
	if (closure.type === "Continuation") {
		throw new Error("Cannot applyContinuation with applyClosure");
	}
	const extended = extendContext(closure.ctx, binder, value, ann);
	if (closure.type === "Closure") {
		return NF.evaluate(extended, closure.term);
	}
	const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
	return closure.compute(...args);
};

type LabelBindings = { labels: EB.Context["labels"]; sigma: EB.Context["sigma"] };

export const collectSigmaBindings = (r1: NF.Row, r2: NF.Row): V2.Elaboration<LabelBindings> =>
	match<[NF.Row, NF.Row], V2.Elaboration<LabelBindings>>([r1, r2])
		.with([{ type: "empty" }, { type: "empty" }], () => V2.of({ labels: {}, sigma: {} }))
		.with([{ type: "empty" }, { type: "variable" }], () => V2.of({ labels: {}, sigma: {} }))
		.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) =>
			V2.Do(function* () {
				const rewritten = R.rewrite(r, label);
				if (E.isLeft(rewritten)) {
					return yield* V2.fail<LabelBindings>(Err.MissingLabel(label, r));
				}
				if (rewritten.right.type !== "extension") {
					return yield* V2.fail<LabelBindings>({ type: "Impossible", message: "Row rewrite must yield extension" });
				}
				const acc = yield* V2.pure(collectSigmaBindings(row, rewritten.right.row));
				return {
					labels: { ...acc.labels, [label]: rewritten.right.value },
					sigma: { ...acc.sigma, [label]: { value } },
				};
			}),
		)
		.otherwise(() => V2.Do(() => V2.fail({ type: "Impossible", message: "Schema verification: incompatible rows" })));

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
export const withRowLabels = <A>(row: NF.Row, comp: V2.Elaboration<A>): V2.Elaboration<A> =>
	V2.Do(function* () {
		const labels = rowFieldTypes(row);
		return yield* V2.local(ctx => {
			const sigma = Object.keys(labels).reduce<EB.Context["sigma"]>(
				(s, label) => ({ ...s, [label]: { value: NF.Constructors.Neutral(NF.Constructors.Var({ type: "Label", name: label })) } }),
				ctx.sigma,
			);
			return { ...ctx, labels: { ...ctx.labels, ...labels }, sigma };
		}, comp);
	});

export const unwrapExistential = (nf: NF.Value): NF.Value =>
	match(NF.unwrapNeutral(nf))
		.with({ type: "Existential" }, e => unwrapExistential(e.body.value))
		.otherwise(() => nf);
