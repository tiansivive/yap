import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: modal", () => {
	it.skip("<*> 1", () => {
		const res = elaborateFrom("<*> Num");
		expect({ displays: res.displays }).toMatchSnapshot();
	});
});

describe("inference: gram annotations (%rule syntax)", () => {
	it("gram only: (r: Rule) -> Num %r", () => {
		const res = elaborateFrom("(r: Rule) -> Num %r");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	it("quantity + gram: (r: Rule) -> <1> Num %r", () => {
		const res = elaborateFrom("(r: Rule) -> <1> Num %r");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	it("liquid + gram: (r: Rule) -> Num [|\\n -> n > 0|] %r", () => {
		const res = elaborateFrom("(r: Rule) -> Num [|\\n -> n > 0|] %r");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	it("quantity + liquid + gram: (r: Rule) -> <1> Num [|\\n -> n > 0|] %r", () => {
		const res = elaborateFrom("(r: Rule) -> <1> Num [|\\n -> n > 0|] %r");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	it("gram type error: non-Rule produces unification constraint", () => {
		const res = elaborateFrom("(x: Num) -> Num %x");
		expect({ displays: res.displays }).toMatchSnapshot();
	});
});
