import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { Usages } from "@yap/shared/modalities/multiplicity";
import { Unwrap } from "../shared/monad.v2";
import { isEqual } from "lodash";

type Annotation = Extract<Src.Term, { type: "annotation" }>;

type Checked = Unwrap<ReturnType<typeof EB.check>>;

export const infer = (node: Annotation): V2.Elaboration<EB.AST> =>
	V2.track(
		["src", node, { action: "infer", description: "Annotation node" }],
		V2.Do<EB.AST, Checked>(function* () {
			const { term, ann } = node;

			const ctx = yield* V2.ask();

			const ast = yield* EB.infer.gen(ann);
			const [_ann, kind]: EB.AST = yield* EB.Icit.insert.gen(ast);
			const nf = NF.evaluate(ctx, _ann);

			//const [_ann, us] = yield* EB.check.gen(ann, nf);
			//const _ty = NF.evaluate(ctx, _ann);
			const [_term, us] = yield* EB.check.gen(term, nf);

			return [_term, nf, us] satisfies EB.AST;
		}),
	);

// V2.Do<EB.AST, Checked>(function* () {
// 	const { ann, term } = node;

// 	// First, infer the RHS of the annotation. If it's a type (has kind Type), behave as before.
// 	// Otherwise, try to normalize it to a literal and treat that as a singleton type.
// 	const inferred = yield* EB.infer.gen(ann);
// 	const [annTm, annTy, us] = yield* EB.Icit.insert.gen(inferred);
// 	const ctx = yield* V2.ask();

// 	let ty: NF.Value | undefined;
// 	if (_.isEqual(annTy, NF.Type)) {
// 		ty = NF.evaluate(ctx, annTm);
// 	} else {
// 		// Try to evaluate to a closed literal (e.g., 1 + 2 ==> 3)
// 		let v: NF.Value | undefined;
// 		try {
// 			v = NF.evaluate(ctx, annTm);
// 		} catch {
// 			v = undefined;
// 		}
// 		if (v && v.type === "Lit" && v.value.type !== "Atom") {
// 			// Accept literal values (Num, Bool, String, unit) as singleton types
// 			ty = v;
// 		}
// 	}

// 	if (!ty) {
// 		// Not a type and didn't normalize to a literal singleton: keep the original helpful mismatch
// 		return yield* V2.fail({ type: "TypeMismatch", left: NF.Type, right: annTy });
// 	}

// 	const [_term] = yield* EB.check.gen(term, ty);
// 	return [_term, ty, us] satisfies EB.AST;
// }),
// 	);
