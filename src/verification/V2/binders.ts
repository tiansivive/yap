import { match, P } from "ts-pattern";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import { Liquid } from "../modalities";
import { reader, type Verification } from "./effects";

export const annotation = (binder: NF.Binder): NF.Value =>
	match(binder)
		.with({ type: "Psi", requirement: P.nonNullable }, ({ annotation, requirement }) =>
			NF.Constructors.Modal(annotation, { quantity: Q.Many, liquid: requirement }),
		)
		.otherwise(({ annotation }) => annotation);

export function* contextual(domain: NF.Value, psiState: NF.Value): Verification<NF.Value> {
	const ctx = yield* reader.ask();
	const unary = yield* Liquid.Predicate.Kind(domain);
	const kind = NF.Constructors.Pi("s", "Explicit", NF.State, yield* NF.closeVal(unary));
	const predicate = yield* Metas.fresh(ctx.env.length, kind, "Predicate");
	return yield* NF.reduce(NF.Constructors.Flex(predicate), psiState, "Explicit");
}

export function* hole(liquid?: NF.Value): Verification<Extract<NF.Variable, { type: "Meta" }> | undefined> {
	if (!liquid) {
		return undefined;
	}
	const registry = yield* Metas.registry.get();
	return match(yield* NF.view(liquid))
		.with(
			NF.View.Flex,
			({ value }) => Metas.lookup(registry, value.variable.val)?.kind === "Predicate",
			({ value }) => value.variable,
		)
		.otherwise(() => undefined);
}
