import * as EB from "@yap/elaboration";
import { OP_AND, OP_EQ, OP_NOT, OP_OR } from "@yap/shared/lib/primitives";

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

export const eq = (p: EB.Term, q: EB.Term): EB.Term => {
	const _eq = EB.Constructors.Var({ type: "Foreign", name: OP_EQ });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _eq, p), q);
	return app;
};

export const neq = (p: EB.Term, q: EB.Term): EB.Term => {
	const _neq = EB.Constructors.Var({ type: "Foreign", name: "$neq" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _neq, p), q);
	return app;
};

export const add = (p: EB.Term, q: EB.Term): EB.Term => {
	const _add = EB.Constructors.Var({ type: "Foreign", name: "$add" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _add, p), q);
	return app;
};

export const sub = (p: EB.Term, q: EB.Term): EB.Term => {
	const _sub = EB.Constructors.Var({ type: "Foreign", name: "$sub" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _sub, p), q);
	return app;
};

export const mul = (p: EB.Term, q: EB.Term): EB.Term => {
	const _mul = EB.Constructors.Var({ type: "Foreign", name: "$mul" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _mul, p), q);
	return app;
};

export const div = (p: EB.Term, q: EB.Term): EB.Term => {
	const _div = EB.Constructors.Var({ type: "Foreign", name: "$div" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _div, p), q);
	return app;
};

export const gt = (p: EB.Term, q: EB.Term): EB.Term => {
	const _gt = EB.Constructors.Var({ type: "Foreign", name: "$gt" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _gt, p), q);
	return app;
};

export const lt = (p: EB.Term, q: EB.Term): EB.Term => {
	const _lt = EB.Constructors.Var({ type: "Foreign", name: "$lt" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _lt, p), q);
	return app;
};

export const gte = (p: EB.Term, q: EB.Term): EB.Term => {
	const _gte = EB.Constructors.Var({ type: "Foreign", name: "$gte" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _gte, p), q);
	return app;
};

export const lte = (p: EB.Term, q: EB.Term): EB.Term => {
	const _lte = EB.Constructors.Var({ type: "Foreign", name: "$lte" });
	const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _lte, p), q);
	return app;
};
