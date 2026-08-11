import { describe, expect, it } from "vitest";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";

import * as Lit from "@yap/shared/literals";

const ctx: EB.Context = {
	env: [],
	implicits: [],
	labels: {},
	sigma: {},
	record: {},
	zonker: {},
	metas: {},
	imports: {},
	ffi: {},
	trace: [],
};

describe("NbE machine on the callstack effect", () => {
	it("normalizes a literal", () => {
		const [value] = Eff.run(() => NF.normalize(EB.Constructors.Lit(Lit.Atom("Type"))), [M.reader.handlers(ctx), Metas.registry.handlers()]);

		expect(value).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Type" } });
	});

	it("beta-reduces an application through the machine", () => {
		const identity = EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Var({ type: "Bound", index: 0 }), EB.Constructors.Lit(Lit.Atom("Type")));
		const term = EB.Constructors.App("Explicit", identity, EB.Constructors.Lit(Lit.Atom("Num")));

		const [value] = Eff.run(() => NF.normalize(term), [M.reader.handlers(ctx), Metas.registry.handlers()]);

		expect(value).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Num" } });
	});

	it("round-trips a value through quote", () => {
		const [term] = Eff.run(() => NF.quote(0, NF.Constructors.Lit(Lit.Atom("Type"))), [M.reader.handlers(ctx), Metas.registry.handlers()]);

		expect(term).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Type" } });
	});
});
