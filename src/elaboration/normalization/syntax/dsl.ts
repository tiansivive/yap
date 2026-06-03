import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";
import { OP_ADD, OP_AND, OP_DIV, OP_EQ, OP_GT, OP_GTE, OP_LT, OP_LTE, OP_MUL, OP_NEQ, OP_NOT, OP_OR, OP_SUB, PrimOps } from "@yap/shared/lib/primitives";
import { NonEmptyArray } from "fp-ts/NonEmptyArray";

const not = (x: NF.Value): NF.Value => {
	const _not = PrimOps[OP_NOT];
	return NF.Constructors.External(OP_NOT, _not.arity, _not.compute, [x]);
};

const and = (p: NF.Value, q: NF.Value): NF.Value => {
	const _and = PrimOps[OP_AND];
	const external = NF.Constructors.External(OP_AND, _and.arity, _and.compute, [p, q]);
	return external;
};

const or = (p: NF.Value, q: NF.Value): NF.Value => {
	const _or = PrimOps[OP_OR];
	const external = NF.Constructors.External(OP_OR, _or.arity, _or.compute, [p, q]);
	return external;
};

const eq = (x: NF.Value, y: NF.Value): NF.Value => {
	const _eq = PrimOps[OP_EQ];
	return NF.Constructors.External(OP_EQ, _eq.arity, _eq.compute, [x, y]);
};

const neq = (x: NF.Value, y: NF.Value): NF.Value => {
	const _neq = PrimOps[OP_NEQ];
	return NF.Constructors.External(OP_NEQ, _neq.arity, _neq.compute, [x, y]);
};

const lt = (x: NF.Value, y: NF.Value): NF.Value => {
	const _lt = PrimOps[OP_LT];
	return NF.Constructors.External(OP_LT, _lt.arity, _lt.compute, [x, y]);
};

const gt = (x: NF.Value, y: NF.Value): NF.Value => {
	const _gt = PrimOps[OP_GT];
	return NF.Constructors.External(OP_GT, _gt.arity, _gt.compute, [x, y]);
};

const lte = (x: NF.Value, y: NF.Value): NF.Value => {
	const _lte = PrimOps[OP_LTE];
	return NF.Constructors.External(OP_LTE, _lte.arity, _lte.compute, [x, y]);
};

const gte = (x: NF.Value, y: NF.Value): NF.Value => {
	const _gte = PrimOps[OP_GTE];
	return NF.Constructors.External(OP_GTE, _gte.arity, _gte.compute, [x, y]);
};

const add = (x: NF.Value, y: NF.Value): NF.Value => {
	const _add = PrimOps[OP_ADD];
	return NF.Constructors.External(OP_ADD, _add.arity, _add.compute, [x, y]);
};
const sub = (x: NF.Value, y: NF.Value): NF.Value => {
	const _sub = PrimOps[OP_SUB];
	return NF.Constructors.External(OP_SUB, _sub.arity, _sub.compute, [x, y]);
};
const mul = (x: NF.Value, y: NF.Value): NF.Value => {
	const _mul = PrimOps[OP_MUL];
	return NF.Constructors.External(OP_MUL, _mul.arity, _mul.compute, [x, y]);
};
const div = (x: NF.Value, y: NF.Value): NF.Value => {
	const _div = PrimOps[OP_DIV];
	return NF.Constructors.External(OP_DIV, _div.arity, _div.compute, [x, y]);
};

export const Unop = { not };
export const Binop = { and, or, lt, gt, lte, gte, eq, neq, add, sub, mul, div };

export const Apply = (icit: Implicitness, func: NF.Value, ...args: NonEmptyArray<NF.Value>): NF.Value => {
	return args.reduce((f, a) => NF.Constructors.App(f, a, icit), func);
};

export const str = (s: string): NF.Value => NF.Constructors.Lit(Lit.String(s));
export const num = (n: number): NF.Value => NF.Constructors.Lit(Lit.Num(n));
export const bool = (b: boolean): NF.Value => NF.Constructors.Lit(Lit.Bool(b));

const mkRow = (...fields: ReadonlyArray<[string, NF.Value]>): NF.Row =>
	fields.reduceRight<NF.Row>((acc, [label, value]) => R.Constructors.Extension(label, value, acc), R.Constructors.Empty());

export const schema = (...fields: ReadonlyArray<[string, NF.Value]>): NF.Value =>
	NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Schema")), NF.Constructors.Row(mkRow(...fields)), "Explicit");

export const array = (...elements: ReadonlyArray<NF.Value>): NF.Value => {
	const row = elements.reduceRight<NF.Row>((acc, el, idx) => R.Constructors.Extension(String(idx), el, acc), R.Constructors.Empty());
	return NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Array")), NF.Constructors.Row(row), "Explicit");
};

export const Rule = {
	pattern: (bind: string, tag: string): NF.Value => schema(["bind", str(bind)], ["tag", str(tag)]),

	constructor: (bind: string, tag: string, payload: Record<string, unknown> = {}): NF.Value =>
		schema(["bind", str(bind)], ["tag", str(tag)], ["payload", str(JSON.stringify(payload))]),

	edge: (source: string, label: string, target: string): NF.Value => schema(["source", str(source)], ["label", str(label)], ["target", str(target)]),

	lhs: (nodes: ReadonlyArray<NF.Value>, edges: ReadonlyArray<NF.Value> = []): NF.Value => schema(["nodes", array(...nodes)], ["edges", array(...edges)]),

	rhs: (nodes: ReadonlyArray<NF.Value>, edges: ReadonlyArray<NF.Value> = []): NF.Value => schema(["nodes", array(...nodes)], ["edges", array(...edges)]),

	rule: (lhs: NF.Value, rhs: NF.Value): NF.Value => schema(["lhs", lhs], ["rhs", rhs]),
};
