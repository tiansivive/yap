import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";

import Grammar from "@qtt/src/grammar";

import * as Log from "@qtt/shared/logging";
import { solve } from "./solver";
import { display } from "./substitution";

describe("Constraint Solver", () => {
	it("should solve constraints", () => {
		const cst = JSON.parse(
			`[{"type":"assign","left":{"type":"Lit","value":{"type":"Atom","value":"Type"}},"right":{"type":"Lit","value":{"type":"Atom","value":"Type"}}},{"type":"assign","left":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","index":1}}},"right":{"type":"Abs","binder":{"type":"Pi","variable":"x","icit":"Explicit","annotation":[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","index":3}}},"Many"]},"closure":{"env":[[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":1}}},"Many"],[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":0}}},"Many"]],"term":{"type":"Var","variable":{"type":"Meta","index":4}}}}},{"type":"assign","left":{"type":"Lit","value":{"type":"Atom","value":"Type"}},"right":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","index":3}}}},{"type":"usage","expected":"Many","computed":"Many"},{"type":"assign","left":{"type":"Neutral","value":{"type":"Var","variable":{"type":"Meta","index":1}}},"right":{"type":"Abs","binder":{"type":"Pi","variable":"a","icit":"Explicit","annotation":[{"type":"Lit","value":{"type":"Atom","value":"Type"}},"Many"]},"closure":{"env":[[{"type":"Neutral","value":{"type":"Var","variable":{"type":"Bound","index":0}}},"Many"]],"term":{"type":"Lit","value":{"type":"Atom","value":"Type"}}}}}]`,
		);
		const empty: EB.Context = {
			env: [],
			types: [],
			names: [],
			imports: {
				Num: [EB.Constructors.Lit(Lit.Atom("Num")), NF.Type, []],
				Bool: [EB.Constructors.Lit(Lit.Atom("Bool")), NF.Type, []],
				String: [EB.Constructors.Lit(Lit.Atom("String")), NF.Type, []],
				Unit: [EB.Constructors.Lit(Lit.Atom("Unit")), NF.Type, []],
			},
		};

		const eqs = cst.filter((c: any) => c.type === "assign");

		const [sub] = M.run(solve(eqs), empty);

		const normalize = (str: string) => str.replace(/\s+/g, "").trim();
		expect(normalize(display(sub))).toEqual(
			normalize(`
                ?1 |=> Π(x:<ω> Type) -> Type
                ?3 |=> Type
                ?4 |=> Type`),
		);
	});
});
