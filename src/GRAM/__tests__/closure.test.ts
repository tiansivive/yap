import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Nodes, Edges, Query, entry } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { capture, close, closureConvert } from "../passes/closure";
import { saturate } from "../passes/saturate";
import { ARITIES } from "../../lowering/shared/primops";

describe("capture", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("identity lambda — no captures, empty env", () => {
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const g = capture(translate(term));
		expect(display(g)).toMatchSnapshot();

		const lams = [...Query.byTag(Tags.LAMBDA)(g)];
		expect(lams).toHaveLength(1);

		const envEdge = Edges.one(lams[0], Labels.ENV)(g);
		expect(envEdge).toBeDefined();
		expect(Edges.byLabel(envEdge?.target ?? -1, Labels.CAPTURE)(g)).toHaveLength(0);
	});

	it("constant body — no captures, empty env", () => {
		const term = EB.DSL.lambda("x", EB.DSL.num(42), EB.DSL.free("Int"));
		const g = capture(translate(term));

		const lamId = [...Query.byTag(Tags.LAMBDA)(g)][0];
		const envId = Edges.one(lamId, Labels.ENV)(g)?.target ?? -1;
		expect(Edges.byLabel(envId, Labels.CAPTURE)(g)).toHaveLength(0);
	});

	it("nested lambda — inner captures outer binder", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const g = capture(translate(outer, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		const lams = [...Query.byTag(Tags.LAMBDA)(g)];
		expect(lams).toHaveLength(2);
		lams.forEach(id => expect(Edges.one(id, Labels.ENV)(g)).toBeDefined());

		const outerLam = lams.find(id => Nodes.get(id)(g)?.payload.variable === "x");
		const innerLam = lams.find(id => Nodes.get(id)(g)?.payload.variable === "y");
		const innerEnv = Edges.one(innerLam ?? -1, Labels.ENV)(g)?.target ?? -1;
		const innerCaptures = Edges.byLabel(innerEnv, Labels.CAPTURE)(g);
		expect(innerCaptures.some(e => e.target === outerLam)).toBe(true);
	});

	it("triple nested — innermost captures both outer binders", () => {
		const body = EB.DSL.add(EB.DSL.bound(2), EB.DSL.bound(0));
		const z = EB.DSL.lambda("z", body, EB.DSL.type("Num"));
		const y = EB.DSL.lambda("y", z, EB.DSL.type("Num"));
		const x = EB.DSL.lambda("x", y, EB.DSL.type("Num"));
		const g = capture(translate(x, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		const lams = [...Query.byTag(Tags.LAMBDA)(g)];
		const zLam = lams.find(id => Nodes.get(id)(g)?.payload.variable === "z");
		const xLam = lams.find(id => Nodes.get(id)(g)?.payload.variable === "x");
		const zEnv = Edges.one(zLam ?? -1, Labels.ENV)(g)?.target ?? -1;
		const zCaptures = Edges.byLabel(zEnv, Labels.CAPTURE)(g);
		expect(zCaptures.some(e => e.target === xLam)).toBe(true);
	});

	it("captures foreign refs", () => {
		const term = EB.DSL.lambda("x", EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.type("Num"));
		const g = capture(translate(term, { arities: ARITIES }));

		const lamId = [...Query.byTag(Tags.LAMBDA)(g)][0];
		const envId = Edges.one(lamId, Labels.ENV)(g)?.target ?? -1;
		const caps = Edges.byLabel(envId, Labels.CAPTURE)(g);
		const foreignDef = [...Query.byTag(Tags.VAR_FOREIGN)(g)][0];
		expect(caps.some(e => e.target === foreignDef)).toBe(true);
	});

	it("captures free var refs", () => {
		const term = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(0)), EB.DSL.free("Int"));
		const g = capture(translate(term));

		const lamId = [...Query.byTag(Tags.LAMBDA)(g)][0];
		const envId = Edges.one(lamId, Labels.ENV)(g)?.target ?? -1;
		const caps = Edges.byLabel(envId, Labels.CAPTURE)(g);
		const freeDef = [...Query.byTag(Tags.VAR_FREE)(g)].find(id => Nodes.get(id)(g)?.payload.name === "f");
		expect(caps.some(e => e.target === freeDef)).toBe(true);
	});

	it("post-saturation — captures still work with primop in body", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const saturated = saturate(translate(outer, { arities: ARITIES }));
		const g = capture(saturated);
		expect(display(g)).toMatchSnapshot();

		const lams = [...Query.byTag(Tags.LAMBDA)(g)];
		lams.forEach(id => expect(Edges.one(id, Labels.ENV)(g)).toBeDefined());
	});

	it("captures let binder", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("a", EB.DSL.num(1), numTy)];
		const body = EB.DSL.lambda("x", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const term = EB.Constructors.Block(stmts, body);
		const g = capture(translate(term, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		const lamId = [...Query.byTag(Tags.LAMBDA)(g)][0];
		const envId = Edges.one(lamId, Labels.ENV)(g)?.target ?? -1;
		const caps = Edges.byLabel(envId, Labels.CAPTURE)(g);
		const letStmt = [...Query.byTag(Tags.STMT_LET)(g)][0];
		expect(caps.some(e => e.target === letStmt)).toBe(true);
	});

	it("idempotent", () => {
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const once = capture(translate(term));
		const twice = capture(once);
		expect(Query.byTag(Tags.ENV)(twice).size).toBe(1);
	});
});

describe("close", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("adds closure node wrapping lambda + env", () => {
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const g = close(capture(translate(term)));
		expect(display(g)).toMatchSnapshot();

		const closures = [...Query.byTag(Tags.CLOSURE)(g)];
		expect(closures).toHaveLength(1);

		const cid = closures[0];
		expect(Nodes.get(Edges.one(cid, Labels.BODY)(g)?.target ?? -1)(g)?.tag).toBe(Tags.LAMBDA);
		expect(Nodes.get(Edges.one(cid, Labels.ENV)(g)?.target ?? -1)(g)?.tag).toBe(Tags.ENV);
	});

	it("closure shares env with lambda", () => {
		const g = closureConvert(translate(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"))));

		const lamEnv = Edges.one([...Query.byTag(Tags.LAMBDA)(g)][0], Labels.ENV)(g)?.target;
		const closureEnv = Edges.one([...Query.byTag(Tags.CLOSURE)(g)][0], Labels.ENV)(g)?.target;
		expect(lamEnv).toBe(closureEnv);
	});

	it("nested lambdas — one closure per lambda", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(0), EB.DSL.free("Int"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.free("Int"));
		const g = closureConvert(translate(outer));

		expect(Query.byTag(Tags.CLOSURE)(g).size).toBe(2);
		expect(Query.byTag(Tags.LAMBDA)(g).size).toBe(2);
	});

	it("idempotent", () => {
		const once = closureConvert(translate(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"))));
		const twice = close(once);
		expect(Query.byTag(Tags.CLOSURE)(twice).size).toBe(1);
	});
});

describe("closureConvert (combined)", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("lambda preserved, app untouched", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int")), EB.DSL.num(42));
		const g = closureConvert(translate(term));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.APP)(g).size).toBe(1);
		expect(Query.byTag(Tags.LAMBDA)(g).size).toBe(1);
		expect(Query.byTag(Tags.CLOSURE)(g).size).toBe(1);
		expect(Query.byTag(Tags.ENV)(g).size).toBe(1);
	});

	it("preserves entry", () => {
		const g = closureConvert(translate(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"))));
		expect(entry(g)).toBeDefined();
	});
});
