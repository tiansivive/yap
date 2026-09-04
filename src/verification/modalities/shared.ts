import * as Q from "@yap/shared/modalities/multiplicity";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
/* Sanctioned straddler: combine runs mid-drive, so it must consume NbE's internal layer. */
// eslint-disable-next-line no-restricted-imports -- sanctioned: mid-drive consumer of NbE internals
import { apply } from "@yap/elaboration/normalization/evaluation.v2";
// eslint-disable-next-line no-restricted-imports -- sanctioned: mid-drive consumer of NbE internals
import { quote } from "@yap/elaboration/normalization/quoting";
import assert from "node:assert";

export type Annotations<T> = {
	quantity: Q.Multiplicity;
	liquid: T;
};

/*
 * Consumes the machine's internal layer: combine is called from inside the
 * evaluator (Modal values merging mid-drive), so its applications must share
 * the ambient machine rather than install a fresh one.
 */
export function* combine(a: Annotations<NF.Value>, b: Annotations<NF.Value>): NF.Evaluation<Annotations<NF.Value>> {
	assert(a.liquid.type === "Abs" && a.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");
	assert(b.liquid.type === "Abs" && b.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");

	const ctx = yield* M.reader.ask();
	const name = `${a.liquid.binder.variable}_and_${b.liquid.binder.variable}`;
	const lvl = ctx.env.length;
	const anf = yield* apply(a.liquid.binder, a.liquid.closure, NF.Constructors.Rigid(lvl));
	const bnf = yield* apply(b.liquid.binder, b.liquid.closure, NF.Constructors.Rigid(lvl));

	const body = NF.DSL.Binop.and(anf, bnf);
	const liquid = NF.Constructors.Lambda(name, "Explicit", NF.Constructors.Closure(ctx, yield* quote(lvl + 1, body)), a.liquid.binder.annotation);

	return { quantity: Q.SR.mul(a.quantity, b.quantity), liquid };
}
