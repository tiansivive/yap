import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Err from "@qtt/elaboration/errors";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";

import Grammar from "@qtt/src/grammar";

import * as Log from "@qtt/shared/logging";
import * as E from "fp-ts/Either";

describe("Unification", () => {
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
		trace: [],
	};

	it("should unify two literals", () => {
		const left = NF.Constructors.Lit(Lit.Num(42));
		const right = NF.Constructors.Lit(Lit.Num(42));

		const [either] = M.run(EB.unify(left, right, 0), empty);

		if (E.isLeft(either)) {
			throw new Error(`Failed solving: ${Err.display(either.left)}`);
		}
		const sub = either.right;

		expect(sub).toEqual({});
	});

	it("should fail unifying two different literals", () => {
		const left = NF.Constructors.Lit(Lit.Num(42));
		const right = NF.Constructors.Lit(Lit.Num(43));

		const [either] = M.run(EB.unify(left, right, 0), empty);

		if (E.isRight(either)) {
			throw new Error(`Expected unification to fail`);
		}

		expect(either.left).toMatchObject(Err.UnificationFailure(left, right));
	});

	it("should unify two lambdas", () => {
		const left = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure([], EB.Constructors.Var(EB.Bound(0))));
		const right = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure([], EB.Constructors.Var(EB.Bound(0))));

		const [either] = M.run(EB.unify(left, right, 0), empty);

		if (E.isLeft(either)) {
			throw new Error(`Failed solving: ${Err.display(either.left)}`);
		}
		const sub = either.right;

		expect(sub).toEqual({});
	});

	it("should fail unifying two different lambdas", () => {
		const left = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure([], EB.Constructors.Var(EB.Bound(0))));
		const right = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure([], EB.Constructors.Lit(Lit.Num(42))));

		const [either] = M.run(EB.unify(left, right, 0), empty);

		if (E.isRight(either)) {
			throw new Error(`Expected unification to fail`);
		}

		expect(either.left).toMatchObject(Err.UnificationFailure(left, right));
	});

	it("should bind a meta to a value", () => {
		const left = NF.Constructors.Neutral(NF.Constructors.Var(EB.Meta(0)));
		const right = NF.Constructors.Lit(Lit.Num(42));

		const [either] = M.run(EB.unify(left, right, 0), empty);

		if (E.isLeft(either)) {
			throw new Error(`Failed solving: ${Err.display(either.left)}`);
		}
		const sub = either.right;

		expect(sub).toEqual({ 0: right });
	});
});
