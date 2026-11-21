// Direct Horn inference assigns a concrete goal to the innermost assumed predicate
// whose formal parameters can express it.

import type { IVL } from "./solver/ivl/types";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { OP_AND, OP_EQ, OP_LIVE, OP_NOT, OP_OR, OP_LT, OP_LTE, OP_GT, OP_GTE, OP_NEQ } from "@yap/shared/lib/primitives";
import { partitionMap } from "fp-ts/Array";
import * as E from "fp-ts/Either";
import { Bool } from "@yap/shared/literals";
import { groupBy, isEqualWith, uniqBy } from "lodash";
import { isMatching, match, P } from "ts-pattern";

export type Binder = { lvl: number; name: string; annotation: NF.Value };
export type Scope = { binders: readonly Binder[]; premises: readonly NF.Value[] };
export type Constraint = Scope & { goal: NF.Value };
export type Predicate = { params: Binder[]; body: NF.Value };
export type Assignment = ReadonlyMap<IVL.Kappa, { params: IVL.Binder[]; body: IVL.Formula }>;

type Application = { kappa: number; args: NF.Value[] };
type Assumption = { kappa: number; params: Binder[] };
type Definition = { tag: "Definition"; kappa: number; predicate: Predicate };
type Use = Definition | { tag: "Open" | "Goal"; kappa: number };

export const solve = (constraints: readonly Constraint[], registry: Metas.Registry): ReadonlyMap<number, Predicate> => {
	const uses = constraints.map(c => requirements(c, registry));
	if (!uses.every((u): u is Use[] => u !== undefined)) {
		return new Map();
	}
	return new Map(Object.values(groupBy(uses.flat(), "kappa")).flatMap(combine));
};

const True = { ...NF.Patterns.Lit, value: { type: "Bool", value: true } } as const;
const False = { ...NF.Patterns.Lit, value: { type: "Bool", value: false } } as const;
const Eq = { ...NF.Patterns.External, name: OP_EQ, args: [P._, P._] } as const;
const Logic = { ...NF.Patterns.External, name: P.union(OP_AND, OP_OR, OP_NOT) } as const;
const Comparison = { ...NF.Patterns.External, name: P.union(OP_EQ, OP_NEQ, OP_LT, OP_LTE, OP_GT, OP_GTE) } as const;
const Live = { ...NF.Patterns.External, name: OP_LIVE } as const;

const view = (value: NF.Value): NF.Value =>
	match(value)
		.with(NF.Patterns.Neutral, NF.Patterns.Modal, ({ value }) => view(value))
		.with(NF.Patterns.Glued, ({ unfolded }) => view(unfolded))
		.otherwise(v => v);

export const conjuncts = (value: NF.Value): NF.Value[] =>
	match(view(value))
		.with({ ...NF.Patterns.External, name: OP_AND }, ({ args }) => args.flatMap(conjuncts))
		.otherwise(() => [value]);

const application = (value: NF.Value, registry: Metas.Registry): Application | undefined =>
	match(view(value))
		.with(NF.Patterns.Flex, ({ variable }) => (Metas.lookup(registry, variable.val)?.kind === "Predicate" ? { kappa: variable.val, args: [] } : undefined))
		.with(NF.Patterns.App, ({ func, arg }) => {
			const head = application(func, registry);
			return head && { ...head, args: [...head.args, arg] };
		})
		.otherwise(() => undefined);

const positive = (value: NF.Value, registry: Metas.Registry): Application | undefined =>
	match(view(value))
		.with(Eq, ({ args: [left, right] }) => (isMatching(True, view(right)) ? application(left, registry) : undefined))
		.otherwise(() => application(value, registry));

const level = (value: NF.Value) =>
	match(view(value))
		.with(NF.Patterns.Rigid, ({ variable }) => variable.lvl)
		.otherwise(() => undefined);
const same = (a: NF.Value, b: NF.Value): boolean =>
	isEqualWith(view(a), view(b), (_left, _right, key) => (key === "id" || key === "compute" ? true : undefined));
const distinct = (binders: readonly Binder[]) => uniqBy(binders, b => b.lvl).length === binders.length;

const requirements = ({ binders, premises, goal }: Constraint, registry: Metas.Registry): Use[] | undefined => {
	const parts = premises.flatMap(conjuncts);
	if (parts.some(p => isMatching(False, view(p)))) {
		return [];
	}
	const classify = (premise: NF.Value): E.Either<NF.Value, Assumption> => {
		const hole = positive(premise, registry);
		const params = hole?.args.map(arg => binders.find(b => b.lvl === level(arg)));
		return hole && params?.every((p): p is Binder => p !== undefined) ? E.right({ kappa: hole.kappa, params }) : E.left(premise);
	};
	const { left: guards, right: assumptions } = partitionMap(classify)(parts.filter(p => !isMatching(True, view(p))));
	const candidates = assumptions.filter(a => distinct(a.params));
	const definitions: Definition[] = candidates.map(({ kappa, params }) => ({ tag: "Definition", kappa, predicate: { params, body: truth() } }));
	const inScope = (v: number) => binders.some(b => b.lvl === v);
	const concrete = (value: NF.Value, accepts: (lvl: number) => boolean) => scoped(value, accepts, registry, true);
	const hole = positive(goal, registry);
	if (isMatching(True, view(goal))) {
		return definitions;
	}
	if (!distinct(binders) || candidates.length !== assumptions.length || !guards.every(g => concrete(g, inScope))) {
		return undefined;
	}
	const reflexive = match(view(goal))
		.with(Eq, ({ args: [a, b] }) => same(a, b) && concrete(goal, () => true))
		.otherwise(() => false);
	if (
		reflexive ||
		guards.some(g => same(g, goal)) ||
		candidates.some(a => a.kappa === hole?.kappa && a.params.length === hole.args.length && a.params.every((p, i) => p.lvl === level(hole.args[i])))
	) {
		return definitions;
	}
	const open = candidates.map(({ kappa }): Use => ({ tag: "Open", kappa }));
	if (hole) {
		return hole.args.every(t => scoped(t, inScope, registry, false)) ? [...open, { tag: "Goal", kappa: hole.kappa }] : undefined;
	}
	if (!concrete(goal, inScope)) {
		return undefined;
	}
	const selected = candidates.reduceRight<Definition | undefined>(
		(chosen, candidate) => chosen ?? abstract(candidate, binders, guards, goal, concrete),
		undefined,
	);
	return selected ? [...definitions, selected] : open;
};

const abstract = (
	{ params, kappa }: Assumption,
	binders: readonly Binder[],
	guards: NF.Value[],
	goal: NF.Value,
	concrete: (v: NF.Value, accepts: (lvl: number) => boolean) => boolean,
): Definition | undefined => {
	const accepts = (lvl: number) => params.some(p => p.lvl === lvl);
	if (!concrete(goal, accepts)) {
		return undefined;
	}
	// A fresh variable constrained only by v = key admits every key of the same type.
	const local = guards.filter(guard =>
		match(view(guard))
			.with(Eq, ({ args: [a, b] }) => {
				const [left, right] = [a, b].map(v => binders.find(p => p.lvl === level(v)));
				const elsewhere = [goal, ...guards.filter(g => g !== guard)];
				const isolated = (p: Binder) => !accepts(p.lvl) && elsewhere.every(f => concrete(f, other => other !== p.lvl));
				return !(left && right && same(left.annotation, right.annotation) && (isolated(left) || isolated(right)));
			})
			.otherwise(() => true),
	);
	if (!local.every(g => concrete(g, accepts))) {
		return undefined;
	}
	const body = local.length ? NF.DSL.Binop.or(NF.DSL.Unop.not(conjunction(local)), goal) : goal;
	return { tag: "Definition", kappa, predicate: { params, body } };
};

const truth = () => NF.Constructors.Lit(Bool(true));
const conjunction = (values: NF.Value[]): NF.Value => (values.length ? values.reduce(NF.DSL.Binop.and) : truth());

const scoped = (value: NF.Value, accepts: (lvl: number) => boolean, registry: Metas.Registry, formula: boolean): boolean => {
	const term = (v: NF.Value) => scoped(v, accepts, registry, false);
	return match(view(value))
		.with(NF.Patterns.Rigid, ({ variable }) => accepts(variable.lvl))
		.with(NF.Patterns.Flex, ({ variable }) => Metas.lookup(registry, variable.val)?.kind !== "Predicate")
		.with(Logic, ({ args }) => formula && args.every(v => scoped(v, accepts, registry, true)))
		.with(Comparison, ({ args }) => formula && args.every(term))
		.with(Live, ({ args }) => formula && term(args[0]) && term(args[3]))
		.with(NF.Patterns.External, ({ args }) => args.every(term))
		.with(NF.Patterns.App, ({ func, arg }) => term(func) && term(arg))
		.with(NF.Patterns.Lit, NF.Patterns.Var, () => true)
		.otherwise(() => false);
};

export const instantiate = (predicate: Predicate, args: NF.Value[]): NF.Value => {
	const actuals = new Map(predicate.params.map((p, i) => [p.lvl, args[i]]));
	const visit = (v: NF.Value): NF.Value =>
		match(view(v))
			.with(NF.Patterns.Rigid, ({ variable }) => actuals.get(variable.lvl) ?? v)
			.with(NF.Patterns.External, ({ name, arity, compute, args }) => NF.Constructors.External(name, arity, compute, args.map(visit)))
			.with(NF.Patterns.App, ({ func, arg, icit }) => NF.Constructors.App(visit(func), visit(arg), icit))
			.otherwise(() => v);
	return visit(predicate.body);
};

const combine = (uses: Use[]): [number, Predicate][] => {
	const definitions = uses.flatMap(u => (u.tag === "Definition" ? [u.predicate] : []));
	if (!definitions.length || uses.some(u => u.tag === "Open")) {
		return [];
	}
	const { params } = definitions[0];
	if (!definitions.every(d => d.params.length === params.length && d.params.every((p, i) => same(p.annotation, params[i].annotation)))) {
		return [];
	}
	const args = params.map(p => NF.Constructors.Rigid(p.lvl));
	const bodies = definitions.filter(d => !isMatching(True, view(d.body))).map(d => instantiate(d, args));
	if (!bodies.length && uses.some(u => u.tag === "Goal")) {
		return [];
	}
	return [[uses[0].kappa, { params, body: conjunction(bodies) }]];
};
