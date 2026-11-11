import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { mkCtx, runEB } from "../../inference/__tests__/util";
import { replay } from "../nondeterminism";

const num = (value: number) => NF.Constructors.Lit({ type: "Num", value });

const candidates = function* () {
	const tag = yield* EB.freshMeta(0, NF.Constructors.Atom("Num"));
	yield* M.st.modify(s => ({ ...s, nondeterminism: { solution: { [tag.val]: [num(1), num(2)] } } }));
	return tag;
};

describe("Nondeterministic constraint replay", () => {
	it("solves the same constraint separately in each candidate", () => {
		const { answer, state } = runEB(mkCtx(), function* () {
			yield* candidates();
			const type = NF.Constructors.Var(yield* EB.freshMeta(0, NF.Type));
			yield* M.constrain({ type: "assign", left: type, right: NF.Constructors.Atom("Num"), lvl: 0 });
			const { constraints } = yield* M.writer.peek();
			return yield* replay(function* () {
				yield* EB.solve(constraints);
				return yield* NF.quote(0, type);
			});
		});
		expect(answer).toMatchObject([
			{ type: "Lit", value: { type: "Atom", value: "Num" } },
			{ type: "Lit", value: { type: "Atom", value: "Num" } },
		]);
		expect(state.discharged.size).toBe(1);
	});

	it("checks a later incompatible candidate and preserves the outer proof state", () => {
		const { answer, state } = runEB(mkCtx(), function* () {
			const tag = yield* candidates();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Var(tag), right: num(1), lvl: 0 });
			const { constraints } = yield* M.writer.peek();
			return yield* replay(() => EB.solve(constraints));
		});
		expect(Eff.failed(answer)).toBe(true);
		expect(state.discharged.size).toBe(0);
	});

	it("publishes only the proofs shared by all candidates", () => {
		const incoming = 7;
		const shared = 8;
		const candidateProofs = [1, 2];
		const { answer, state } = runEB(mkCtx(), function* () {
			const tag = yield* candidates();
			yield* M.st.modify(s => ({ ...s, discharged: new Set([incoming]) }));
			return yield* replay(function* (candidate) {
				const before = [...(yield* M.st.get()).discharged];
				const candidateProof = candidate[tag.val] === (yield* M.st.get()).nondeterminism.solution[tag.val][0] ? candidateProofs[0] : candidateProofs[1];
				yield* M.st.modify(s => ({ ...s, discharged: new Set([...s.discharged, shared, candidateProof]) }));
				return before;
			});
		});
		expect(answer).toEqual([[incoming], [incoming]]);
		expect(state.discharged).toEqual(new Set([incoming, shared]));
	});
});
