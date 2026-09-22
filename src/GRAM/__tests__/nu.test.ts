import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import { Edges, Nodes, Query, resetId } from "../graph";
import { compile } from "../pipeline";
import { resolveLabels } from "../passes/resolve-labels";
import { translate } from "../translate";
import { Labels, Tags } from "../vocabulary";

const nuLabel = (name: string, index = 0): EB.Term => EB.Constructors.Var(EB.Constructors.Vars.NuLabel(name, index, NF.Type));

const nu = (fields: ReadonlyArray<{ readonly label: string; readonly value: EB.Term }>): EB.Term =>
	EB.Constructors.Nu("$nu", EB.DSL.type("Row"), EB.DSL.struct([...fields]));

const reset = () => {
	EB.resetId();
	resetId();
};

describe("Nu GRAM enrichment", () => {
	beforeEach(reset);

	it("preserves Nu and resolves its scoped labels to fields", () => {
		const g = resolveLabels(
			translate(
				nu([
					{ label: "a", value: EB.DSL.num(1) },
					{ label: "b", value: nuLabel("a") },
				]),
			),
		);

		const nus = [...Query.byTag(Tags.NU)(g)];
		const labels = [...Query.byTag(Tags.VAR_NU_LABEL)(g)];
		const structs = [...Query.byTag(Tags.STRUCT)(g)];

		expect(nus).toHaveLength(1);
		expect(labels).toHaveLength(1);
		expect(structs).toHaveLength(1);

		const target = Edges.one(labels[0], Labels.REFERS_TO)(g)?.target;
		const field = Edges.byLabel(structs[0], Labels.FIELD)(g).find(e => e.payload.label === "a")?.target;
		expect(target).toBe(field);
	});

	it("admits acyclic Nu field dependencies", () => {
		expect(() =>
			compile(
				nu([
					{ label: "a", value: EB.DSL.num(1) },
					{ label: "b", value: nuLabel("a") },
				]),
			),
		).not.toThrow();
	});

	it("adds a hoist candidate for a Nu-label target", () => {
		const result = compile(
			nu([
				{ label: "a", value: EB.DSL.num(1) },
				{ label: "b", value: nuLabel("a") },
			]),
		);

		expect(result._tag).toBe("Right");
		if (result._tag === "Left") {
			return;
		}

		const g = result.right;
		const struct = [...Query.byTag(Tags.STRUCT)(g)][0];
		const target = Edges.byLabel(struct, Labels.FIELD)(g).find(e => e.payload.label === "a")?.target;
		expect(Edges.byLabel(struct, Labels.HOIST)(g).map(e => e.target)).toEqual([target]);
	});

	it("rejects eager Nu cycles", () => {
		expect(() =>
			compile(
				nu([
					{ label: "a", value: nuLabel("b") },
					{ label: "b", value: nuLabel("a") },
				]),
			),
		).toThrow(/eager cyclic field reference/);
	});

	it("adds capture and backpatch edges for guarded Nu recursion", () => {
		const result = compile(nu([{ label: "loop", value: EB.DSL.lambda("n", nuLabel("loop", 1), EB.DSL.type("Num")) }]));

		expect(result._tag).toBe("Right");
		if (result._tag === "Left") {
			return;
		}

		const g = result.right;
		const struct = [...Query.byTag(Tags.STRUCT)(g)][0];
		const lambda = [...Query.byTag(Tags.LAMBDA)(g)][0];
		const closure = [...Query.byTag(Tags.CLOSURE)(g)][0];
		const env = Edges.one(closure, Labels.ENV)(g)?.target;
		const field = Edges.byLabel(struct, Labels.FIELD)(g).find(e => e.target === lambda);

		expect(Edges.byLabel(env ?? -1, Labels.CAPTURE)(g).some(e => e.target === struct)).toBe(true);
		expect(field?.payload.backpatch).toBeUndefined();
		expect(Edges.byLabel(struct, Labels.BACKPATCH)(g).some(e => e.target === lambda)).toBe(true);
		expect(Nodes.get([...Query.byTag(Tags.NU)(g)][0])(g)?.tag).toBe(Tags.NU);
	});

	it("captures Nu records only across lambdas nested inside the Nu", () => {
		const term = EB.DSL.lambda("outer", nu([{ label: "loop", value: EB.DSL.lambda("inner", nuLabel("loop", 1), EB.DSL.type("Num")) }]), EB.DSL.type("Num"));
		const result = compile(term);

		expect(result._tag).toBe("Right");
		if (result._tag === "Left") {
			return;
		}

		const g = result.right;
		const struct = [...Query.byTag(Tags.STRUCT)(g)][0];
		const outer = [...Query.byTag(Tags.LAMBDA)(g)].find(id => Nodes.get(id)(g)?.payload.variable === "outer") ?? -1;
		const inner = [...Query.byTag(Tags.LAMBDA)(g)].find(id => Nodes.get(id)(g)?.payload.variable === "inner") ?? -1;
		const outerEnv = Edges.one(outer, Labels.ENV)(g)?.target ?? -1;
		const innerEnv = Edges.one(inner, Labels.ENV)(g)?.target ?? -1;
		expect(Edges.byLabel(outerEnv, Labels.CAPTURE)(g).some(e => e.target === struct)).toBe(false);
		expect(Edges.byLabel(innerEnv, Labels.CAPTURE)(g).some(e => e.target === struct)).toBe(true);
	});
});
