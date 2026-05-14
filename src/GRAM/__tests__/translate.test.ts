import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Nodes, Query, Edges } from "../graph";
import { Tags, Labels } from "../vocabulary";

describe("GRAM translate", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("Lit(42)", () => {
		const g = translate(EB.DSL.num(42));
		expect(display(g)).toMatchSnapshot();
	});

	it("Lit(true)", () => {
		const g = translate(EB.DSL.bool(true));
		expect(display(g)).toMatchSnapshot();
	});

	it("Lit(string)", () => {
		const g = translate(EB.DSL.str("hello"));
		expect(display(g)).toMatchSnapshot();
	});

	it("Free variable", () => {
		const g = translate(EB.DSL.free("x"));
		expect(display(g)).toMatchSnapshot();
	});

	it("Foreign variable", () => {
		const g = translate(EB.DSL.foreign("$add"));
		expect(display(g)).toMatchSnapshot();
	});

	it("Lambda(x, Bound(0)) — identity", () => {
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();

		const lambdas = Query.byTag(Tags.LAMBDA)(g);
		expect(lambdas.size).toBe(1);
		const lamId = [...lambdas][0];

		const bodyId = Query.follow(lamId, Labels.BODY)(g);
		expect(bodyId).toBeDefined();
		expect(bodyId).toBeDefined();
		expect(Nodes.get(bodyId ?? -1)(g)?.tag).toBe(Tags.VAR_BOUND);

		const ref = Query.follow(bodyId ?? -1, Labels.REFERS_TO)(g);
		expect(ref).toBe(lamId);
	});

	it("nested lambdas — de Bruijn resolution", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.free("Int"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.free("Int"));
		const g = translate(outer);
		expect(display(g)).toMatchSnapshot();

		const lambdas = [...Query.byTag(Tags.LAMBDA)(g)];
		const outerLam = lambdas.find(id => Nodes.get(id)(g)?.payload.variable === "x")!;
		const innerBody = Query.follow(outerLam, Labels.BODY, Labels.BODY)(g);

		expect(innerBody).toBeDefined();
		expect(Query.follow(innerBody ?? -1, Labels.REFERS_TO)(g)).toBe(outerLam);
	});

	it("App(Lambda(x, Bound(0)), Num(1))", () => {
		const lam = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const term = EB.DSL.app(lam, EB.DSL.num(1));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();
	});

	it("free variable interning — two refs share one definition", () => {
		const term = EB.DSL.app(EB.DSL.free("f"), EB.DSL.free("f"));
		const g = translate(term);

		const defs = Query.byTag(Tags.VAR_FREE)(g);
		expect(defs.size).toBe(1);

		const refs = Query.byTag(Tags.VAR_REF)(g);
		expect(refs.size).toBe(2);

		const defId = [...defs][0];
		for (const refId of refs) {
			expect(Query.follow(refId, Labels.REFERS_TO)(g)).toBe(defId);
		}
	});

	it("struct — row extension chain", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();
	});

	it("projection", () => {
		const term = EB.DSL.proj("x", EB.DSL.free("r"));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();
	});

	it("match with alternatives", () => {
		const term = EB.DSL.match(EB.DSL.bound(0), [
			{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
			{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
		]);
		const outer = EB.DSL.lambda("x", term, EB.DSL.free("Int"));
		const g = translate(outer);
		expect(display(g)).toMatchSnapshot();
	});

	it("add(1, 2) — curried foreign primop", () => {
		const g = translate(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)));
		expect(display(g)).toMatchSnapshot();
	});

	it("(λx.λy.x+y) 3 4 — curried closure", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();

		const apps = Query.byTag(Tags.APP)(g);
		expect(apps.size).toBe(4);

		const lambdas = [...Query.byTag(Tags.LAMBDA)(g)];
		expect(lambdas).toHaveLength(2);
	});

	it("proj('x', struct({ x: 42 }))", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();

		const projs = Query.byTag(Tags.PROJ)(g);
		expect(projs.size).toBe(1);
		const projId = [...projs][0];
		expect(Nodes.get(projId)(g)?.payload.label).toBe("x");
	});

	it("injection — { r | tag = value }", () => {
		const term = EB.DSL.inj("tag", EB.DSL.str("hello"), EB.DSL.free("r"));
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();

		const injs = Query.byTag(Tags.INJ)(g);
		expect(injs.size).toBe(1);
		const injId = [...injs][0];
		expect(Query.follow(injId, Labels.VALUE)(g)).toBeDefined();
		expect(Query.follow(injId, Labels.TARGET)(g)).toBeDefined();
	});

	it("match on variant (Some 42)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		const g = translate(term);
		expect(display(g)).toMatchSnapshot();

		const cases = [...Query.byTag(Tags.CASE)(g)];
		expect(cases).toHaveLength(2);
	});

	it("block — let x=1; let y=2; x+y", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy), EB.Constructors.Stmt.Let("y", EB.DSL.num(2), numTy)];
		const ret = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		const g = translate(EB.Constructors.Block(stmts, ret));
		expect(display(g)).toMatchSnapshot();

		const stmtLets = Query.byTag(Tags.STMT_LET)(g);
		expect(stmtLets.size).toBe(2);

		const blocks = [...Query.byTag(Tags.BLOCK)(g)];
		expect(blocks).toHaveLength(1);
		expect(Query.follow(blocks[0], Labels.RETURN)(g)).toBeDefined();
	});

	it("reset(shift k -> k 42) — single resume", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const g = translate(EB.Constructors.Reset(EB.Constructors.Shift(body)));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.RESET)(g).size).toBe(1);
		expect(Query.byTag(Tags.SHIFT)(g).size).toBe(1);
		expect(Query.byTag(Tags.LAMBDA)(g).size).toBe(1);
	});

	it("reset(shift k -> (k 1) + (k 2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const g = translate(EB.Constructors.Reset(EB.Constructors.Shift(body)));
		expect(display(g)).toMatchSnapshot();

		const vars = [...Query.byTag(Tags.VAR_BOUND)(g)];
		const kRefs = vars.filter(id => Nodes.get(id)(g)?.payload.index === 0);
		expect(kRefs).toHaveLength(2);

		const lamId = [...Query.byTag(Tags.LAMBDA)(g)][0];
		kRefs.forEach(id => expect(Query.follow(id, Labels.REFERS_TO)(g)).toBe(lamId));
	});

	it("triple nested lambda — de Bruijn indices at all depths", () => {
		const body = EB.DSL.add(EB.DSL.add(EB.DSL.bound(2), EB.DSL.bound(1)), EB.DSL.bound(0));
		const z = EB.DSL.lambda("z", body, EB.DSL.type("Num"));
		const y = EB.DSL.lambda("y", z, EB.DSL.type("Num"));
		const x = EB.DSL.lambda("x", y, EB.DSL.type("Num"));
		const g = translate(x);
		expect(display(g)).toMatchSnapshot();

		const lambdas = [...Query.byTag(Tags.LAMBDA)(g)];
		const byName = (name: string) => lambdas.find(id => Nodes.get(id)(g)?.payload.variable === name)!;
		const xLam = byName("x"),
			yLam = byName("y"),
			zLam = byName("z");

		const bounds = [...Query.byTag(Tags.VAR_BOUND)(g)];
		const refTargets = bounds.map(id => [Nodes.get(id)(g)?.payload.index, Query.follow(id, Labels.REFERS_TO)(g)]);

		expect(refTargets).toContainEqual([0, zLam]);
		expect(refTargets).toContainEqual([1, yLam]);
		expect(refTargets).toContainEqual([2, xLam]);
	});

	it("foreign variable interning across nested apps", () => {
		const term = EB.DSL.add(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)), EB.DSL.num(3));
		const g = translate(term);

		const foreignDefs = Query.byTag(Tags.VAR_FOREIGN)(g);
		expect(foreignDefs.size).toBe(1);

		const refs = Query.byTag(Tags.VAR_REF)(g);
		expect(refs.size).toBe(2);

		const defId = [...foreignDefs][0];
		expect(Nodes.get(defId)(g)?.payload.name).toBe("$add");
		[...refs].forEach(r => expect(Query.follow(r, Labels.REFERS_TO)(g)).toBe(defId));
	});
});
