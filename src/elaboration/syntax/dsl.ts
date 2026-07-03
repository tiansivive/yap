import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { OP_AND, OP_EQ, OP_NOT, OP_OR } from "@yap/shared/lib/primitives";
import type { Alternative, Pattern } from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

// Core term builders (literals, variables)
export const num = (n: number): EB.Term => EB.Constructors.Lit(Lit.Num(n));
export const bool = (b: boolean): EB.Term => EB.Constructors.Lit(Lit.Bool(b));
export const str = (s: string): EB.Term => EB.Constructors.Lit(Lit.String(s));
export const bound = (i: number): EB.Term => EB.Constructors.Var(EB.Constructors.Vars.Bound(i));
export const free = (name: string): EB.Term => EB.Constructors.Var(EB.Constructors.Vars.Free(name));
export const foreign = (name: string): EB.Term => EB.Constructors.Var(EB.Constructors.Vars.Foreign(name));
export const type = (name: string): EB.Term => EB.Constructors.Lit(Lit.Atom(name));
export const lambda = (variable: string, body: EB.Term, annotation: EB.Term): EB.Term => EB.Constructors.Lambda(variable, "Explicit", body, annotation);

export const app = (func: EB.Term, arg: EB.Term): EB.Term => EB.Constructors.App("Explicit", func, arg);

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

// Structural: struct, proj, inj
export const struct = (fields: Array<{ label: string; value: EB.Term }>): EB.Term => {
	const row = fields.reduceRight<EB.Row>((acc, { label, value }) => R.Constructors.Extension(label, value, acc), R.Constructors.Empty() satisfies EB.Row);
	return EB.Constructors.Struct(row);
};

export const proj = (label: string, term: EB.Term): EB.Term => EB.Constructors.Proj(label, term);

export const inj = (label: string, value: EB.Term, term: EB.Term): EB.Term => EB.Constructors.Inj(label, value, term);

/** Pattern builders — namespace-based, extensible. */
export const Pat = {
	/** Build a variant pattern: { [tag]: payloadPattern }. Binder("x") for payload binds the payload. */
	variant: (tag: string, payload: Pattern): Pattern => EB.Constructors.Patterns.Variant(R.Constructors.Extension(tag, payload, R.Constructors.Empty())),
};

/** Build match(scrutinee, alternatives). Alternatives: [pattern, term] pairs. */
export const match = (scrutinee: EB.Term, alts: Array<{ pattern: Pattern; term: EB.Term }>): EB.Term => {
	const dummyBinder: [string, NF.Value] = ["_", NF.Constructors.Lit(Lit.Atom("Num"))];
	const alternatives: Alternative[] = alts.map(({ pattern, term }) => {
		const binders: [string, NF.Value][] = pattern.type === "Variant" || pattern.type === "Binder" ? [dummyBinder] : [];
		return EB.Constructors.Alternative(pattern, term, binders);
	});
	return EB.Constructors.Match(scrutinee, alternatives);
};
