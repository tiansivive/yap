import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import * as GRAM from "../index";
import { Tags, Labels } from "../vocabulary";
import { Query, Nodes, resetId as resetGraphId } from "../graph";

beforeEach(() => {
	EB.resetId();
	NF.resetId();
	resetGraphId();
});

const { Rule } = NF.DSL;

const mkMinimalCtx = (imports: Record<string, [unknown, NF.Value, unknown]>): EB.Context =>
	({
		imports,
		gamma: [],
		sigma: {},
		record: {},
		zonker: { forward: new Map(), backward: new Map() },
		metas: {},
		ffi: {},
		trace: [],
		implicits: [],
	}) as unknown as EB.Context;

describe("Kernel integration: tailcall identification", () => {
	const mkTailcallRule = (): NF.Value =>
		Rule.rule(
			Rule.lhs([Rule.pattern("lam", Tags.LAMBDA), Rule.pattern("app", Tags.APP)], [Rule.edge("lam", Labels.BODY, "app")]),
			Rule.rhs([Rule.constructor("lam", Tags.LAMBDA), Rule.constructor("app", Tags.APP, { tailcall: true })], [Rule.edge("lam", Labels.BODY, "app")]),
		);

	it("marks app nodes in tail position with tailcall payload", () => {
		const ctx = mkMinimalCtx({
			tailcallRule: [undefined, mkTailcallRule(), undefined],
		});

		const innerApp = EB.DSL.app(EB.DSL.free("f"), EB.DSL.num(1));
		const lambda = EB.DSL.lambda("x", innerApp, EB.DSL.free("Num"));
		const modalTerm = EB.Constructors.Modal(lambda, {
			quantity: "Many",
			liquid: EB.DSL.bool(true),
			gram: EB.DSL.free("tailcallRule"),
		});

		const result = GRAM.Pipeline.compile(modalTerm, { ctx });

		expect(result._tag).toBe("Right");

		if (result._tag === "Right") {
			const graph = result.right;

			const apps = [...Query.byTag(Tags.APP)(graph)];
			expect(apps.length).toBeGreaterThan(0);

			const appWithTailcall = apps.find(id => {
				const node = Nodes.get(id)(graph);
				return node?.payload.tailcall === true;
			});

			expect(appWithTailcall).toBeDefined();
		}
	});

	it("does not mark apps that are not in tail position", () => {
		const ctx = mkMinimalCtx({
			tailcallRule: [undefined, mkTailcallRule(), undefined],
		});

		const nestedApp = EB.DSL.app(EB.DSL.free("f"), EB.DSL.num(1));
		const outerApp = EB.DSL.app(EB.DSL.free("g"), nestedApp);
		const lambda = EB.DSL.lambda("x", outerApp, EB.DSL.free("Num"));
		const modalTerm = EB.Constructors.Modal(lambda, {
			quantity: "Many",
			liquid: EB.DSL.bool(true),
			gram: EB.DSL.free("tailcallRule"),
		});

		const result = GRAM.Pipeline.compile(modalTerm, { ctx });

		expect(result._tag).toBe("Right");

		if (result._tag === "Right") {
			const graph = result.right;

			const apps = [...Query.byTag(Tags.APP)(graph)];

			const tailcallApps = apps.filter(id => {
				const node = Nodes.get(id)(graph);
				return node?.payload.tailcall === true;
			});

			expect(tailcallApps.length).toBe(1);

			const directBodyApp = Query.follow([...Query.byTag(Tags.LAMBDA)(graph)][0], Labels.BODY)(graph);
			expect(tailcallApps[0]).toBe(directBodyApp);
		}
	});

	it("works without gram annotation (kernel pass is no-op)", () => {
		const ctx = mkMinimalCtx({});

		const innerApp = EB.DSL.app(EB.DSL.free("f"), EB.DSL.num(1));
		const lambda = EB.DSL.lambda("x", innerApp, EB.DSL.free("Num"));

		const result = GRAM.Pipeline.compile(lambda, { ctx });

		expect(result._tag).toBe("Right");

		if (result._tag === "Right") {
			const graph = result.right;
			const apps = [...Query.byTag(Tags.APP)(graph)];

			const tailcallApps = apps.filter(id => {
				const node = Nodes.get(id)(graph);
				return node?.payload.tailcall === true;
			});

			expect(tailcallApps.length).toBe(0);
		}
	});
});
