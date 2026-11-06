import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { defaultContext } from "@yap/shared/lib/primitives";

/*
 * Anonymous delimited control in the core shape elaboration produces, for tests that build terms directly. A reset
 * installs the application handler for a hidden identity, and a capture inside a bubble sends it a function of the
 * continuation. The types are those of a numeric continuation.
 */
const identity = () => EB.DSL.type("$anonymous");
const num = () => EB.DSL.type("Num");
const continuation = () => EB.Constructors.Pi("x", "Explicit", num(), num());
const payload = () => EB.Constructors.Pi("k", "Explicit", continuation(), num());

export const Control = {
	reset: (body: EB.Term): EB.Term =>
		EB.Constructors.Reset(
			body,
			identity(),
			EB.DSL.lambda("$payload", EB.DSL.lambda("$k", EB.DSL.app(EB.DSL.bound(1), EB.DSL.bound(0)), continuation()), payload()),
		),

	capture: (sent: EB.Term): EB.Term => {
		const ctx = defaultContext();
		const request = NF.Constructors.Pi(
			"k",
			"Explicit",
			NF.Constructors.Pi("x", "Explicit", NF.Constructors.Lit(Lit.Atom("Num")), NF.Constructors.Closure(ctx, num())),
			NF.Constructors.Closure(ctx, num()),
		);
		return EB.Constructors.Bubble(0, NF.Constructors.Lit(Lit.Atom("Num")), request, [], identity(), sent);
	},
};
