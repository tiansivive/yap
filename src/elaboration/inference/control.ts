import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";

export const capture = (node: Extract<Src.Term, { type: "capture" }>): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Capture" } }, function* () {
		const [identity, carrier, identityUsages] = yield* EB.Icit.insert(yield* EB.infer(node.identity));
		const [payload, result] = yield* signature(carrier);
		const [value, usages] = yield* EB.check(node.term, payload);
		const annotation = yield* NF.quote((yield* M.reader.ask()).env.length, result);

		return [EB.Constructors.Capture(identity, value, annotation), result, Q.add(identityUsages, usages)] satisfies EB.AST;
	});

function* signature(carrier: NF.Value): M.Elaboration<[NF.Value, NF.Value]> {
	const { value } = yield* NF.view(carrier);
	return yield* match(value)
		.with(NF.Patterns.Effect, function* ({ func, arg }) {
			return [func.arg, arg] satisfies [NF.Value, NF.Value];
		})
		.otherwise(function* () {
			const lvl = (yield* M.reader.ask()).env.length;
			const payload = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
			const result = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
			const effect = NF.Constructors.App(NF.Constructors.App(NF.Constructors.Atom("Effect"), payload, "Explicit"), result, "Explicit");
			yield* M.constrain({ type: "assign", left: carrier, right: effect, lvl });
			return [payload, result] satisfies [NF.Value, NF.Value];
		});
}
