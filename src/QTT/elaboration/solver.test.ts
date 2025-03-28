import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Nearley from "nearley";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Err from "@qtt/elaboration/errors";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as Lib from "@qtt/shared/lib/primitives";

import Grammar from "@qtt/src/grammar";

import * as Log from "@qtt/shared/logging";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";

import { solve } from "./solver";
import { display } from "./substitution";

describe("Constraint Solver", () => {
	const empty: EB.Context = {
		env: [],
		types: [],
		names: [],
		implicits: [],
		imports: Lib.Elaborated,
		sigma: {},
		trace: [],
	};

	describe.skip("Need to generate some snapshots", () => {
		it("should solve constraints", () => {
			const cst = JSON.parse(
				`[{"type":"assign","left":{"type":"Lit","value":{"type":"Atom","value":"Type"}},"right":{"type":"Lit","value":{"type":"Atom","value":"Type"}}},{"type":"assign","left":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","val":1}}},"right":{"type":"Abs","binder":{"type":"Pi","variable":"x","icit":"Explicit","annotation":[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","val":3}}},"Many"]},"closure":{"env":[[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":1}}},"Many"],[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":0}}},"Many"]],"term":{"type":"Var","variable":{"type":"Meta","val":4}}}}},{"type":"assign","left":{"type":"Lit","value":{"type":"Atom","value":"Type"}},"right":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","val":3}}}},{"type":"usage","expected":"Many","computed":"Many"},{"type":"assign","left":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","val":1}}},"right":{"type":"Abs","binder":{"type":"Pi","variable":"a","icit":"Explicit","annotation":[{"type":"Lit","value":{"type":"Atom","value":"Type"}},"Many"]},"closure":{"env":[[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":0}}},"Many"]],"term":{"type":"Lit","value":{"type":"Atom","value":"Type"}}}}}]`,
			);

			const eqs = cst.filter((c: any) => c.type === "assign").map((c: any) => ({ ...c, provenance: [] }));

			const [either] = M.run(solve(eqs), empty);

			if (E.isLeft(either)) {
				throw new Error(`Failed solving: ${Err.display(either.left)}`);
			}
			const sub = either.right;

			const normalize = (str: string) => str.replace(/\s+/g, "").trim();
			expect(normalize(display(sub))).toEqual(
				normalize(`
                ?1 |=> Π(x:<ω> Type) -> Type
                ?3 |=> Type
                ?4 |=> Type`),
			);
		});
	});

	it("should fail to unify", () => {
		const src = `match x | 1 -> 2 | 3 -> "hello"`;

		const g = Grammar;
		g.ParserStart = "Ann";
		const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });

		const mock = vi.spyOn(console, "error").mockImplementation(() => {});

		EB.resetSupply("meta");
		EB.resetSupply("var");
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const expr = data.results[0];

		const actions = F.pipe(
			EB.infer(expr),
			M.listen(([, { constraints }]) => constraints.filter(c => c.type === "assign")),
			M.chain(solve),
		);

		const ctx = EB.bind(empty, { type: "Lambda", variable: "x" }, [NF.Constructors.Lit(Lit.Atom("Num")), Q.Many]);
		const [either] = M.run(actions, ctx);

		if (E.isRight(either)) {
			throw new Error(`Expected unification to fail`);
		}

		expect(either.left).toMatchObject({ type: "UnificationFailure" });
		expect(mock).toHaveBeenCalled();
	});
});
