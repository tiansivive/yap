import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import { shown } from "../inference/__tests__/util";
import { declaration, elaborateModule } from "./module";

/**
 * `Tag a` mentions `a`, so matching the goal `Tag ?a` against `NumTag : Tag Num`
 * can only succeed by binding `?a := Num` — a fact nothing in `reused` entails.
 * Resolution selects evidence rather than deriving type facts, so the candidate
 * must be passed over and the dictionary re-quantified at the let boundary.
 *
 * The dictionary is never projected, keeping this off the projection-on-symbolic
 * path so the invariant is testable independently of it.
 */
const SRC = `
let Tag: Type -> Type = \\a -> { tag: a };
let NumTag: Tag Num = { tag: 1 };
using NumTag;
let idOf: (a: Type) => (t: Tag a) => a -> a = \\x -> x;
let reused = idOf;
`;

type Abs = Extract<EB.Term, { type: "Abs" }>;

describe("Implicit resolution", () => {
	it("passes over a candidate whose match would bind the goal's own meta", () => {
		const reused = declaration(elaborateModule(SRC), "reused");

		expect(reused?.error).toBeUndefined();
		expect(reused?.elaborated).toBeDefined();

		const { tm, ty, ctx, registry } = reused!.elaborated!;

		/* Committing @NumTag instead would leave the body under one binder, applying a hard-coded dictionary. */
		const outer = tm as Abs;
		expect(outer.type).toBe("Abs");
		expect((outer.binding as { icit: string }).icit).toBe("Implicit");

		const inner = outer.body as Abs;
		expect(inner.type).toBe("Abs");
		expect((inner.binding as { icit: string }).icit).toBe("Implicit");

		const disp = shown(ctx, registry);
		const type = disp(function* () {
			return yield* EB.Display.Term(yield* NF.quote(ctx.env.length, ty), { deBruijn: false });
		});

		/* The dictionary's own field survives in the principal type; committing @NumTag erases the binder entirely. */
		expect(type).toContain("tag");
		expect({ type }).toMatchSnapshot();
	});
});
