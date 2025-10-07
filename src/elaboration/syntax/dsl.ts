import * as EB from "@yap/elaboration";
import { OP_AND, OP_NOT, OP_OR } from "@yap/shared/lib/primitives";

export const and = (p: EB.Term, q: EB.Term): EB.Term => {
	const _and = EB.Constructors.Var({ type: "Foreign", name: OP_AND });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _and, p), q);
	return app;
};

export const or = (p: EB.Term, q: EB.Term): EB.Term => {
	const _or = EB.Constructors.Var({ type: "Foreign", name: OP_OR });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _or, p), q);
	return app;
};

export const not = (p: EB.Term): EB.Term => {
	const _not = EB.Constructors.Var({ type: "Foreign", name: OP_NOT });
	const app = EB.Constructors.App("Explicit", _not, p);
	return app;
};
