// Direct Horn inference assigns each concrete goal to the innermost assumed predicate
// whose formal parameters can express it. IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/refinement-inference.md

import * as O from "fp-ts/lib/Option";
import { pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";
import fp from "lodash/fp";
import { isEqual, isEqualWith, isObject, omit, uniqBy } from "lodash";
import { isMatching, match } from "ts-pattern";
import { Build, Patterns, type IVL } from "./solver/ivl";
import { Substitute } from "./solver/ivl/substitute";

export const Positive = { tag: "Atom", op: "=", args: [Patterns.Term.Hole, { tag: "Bool", value: true }] } as const;
const Alias = { tag: "Atom", op: "=", args: [Patterns.Term.Var, Patterns.Term.Var] } as const;

export const solve = (constraints: readonly Constraint[]): Assignment =>
	pipe(
		constraints,
		O.traverseArray(requirements),
		O.getOrElse(RA.zero<Use[]>),
		RA.flatten,
		fp.groupBy<Use>("kappa"),
		Object.values,
		RA.flatMap(combine),
		entries => new Map(entries),
	);

export type Assumption = { kappa: IVL.Kappa; params: IVL.Binder[] };
export type Scope = { binders: readonly IVL.Binder[]; assumptions: readonly Assumption[]; guards: readonly IVL.Formula[] };
export type Constraint = Scope & { goal: IVL.Formula };
export type Predicate = { params: IVL.Binder[]; body: IVL.Formula };
export type Assignment = ReadonlyMap<IVL.Kappa, Predicate>;

type Definition = { tag: "Definition"; kappa: IVL.Kappa; predicate: Predicate };
type Use = Definition | { tag: "Open"; kappa: IVL.Kappa } | { tag: "Goal"; kappa: IVL.Kappa };

const requirements = ({ binders, assumptions, guards, goal }: Constraint): O.Option<Use[]> => {
	if (guards.some(isMatching(Patterns.Formula.False))) {
		return O.some([]);
	}
	const bound = (v: IVL.Binder) => binders.some(b => sameBinder(b, v));
	const candidates = assumptions.filter(({ params }) => params.every(bound) && distinct(params));
	const definitions: Definition[] = candidates.map(({ kappa, params }) => ({ tag: "Definition", kappa, predicate: { params, body: Build.true_() } }));
	const wellScoped = distinct(binders) && candidates.length === assumptions.length && guards.every(g => scoped(g, bound));
	const open = (): Use[] => candidates.map(({ kappa }) => ({ tag: "Open", kappa }));

	return match(goal)
		.with(Patterns.Formula.True, () => O.some(definitions))
		.when(
			() => !wellScoped,
			() => O.none,
		)
		.when(
			g => discharged(g, guards, candidates),
			() => O.some(definitions),
		)
		.with(
			Positive,
			({ args: [hole] }): O.Option<Use[]> => (hole.spine.every(t => term(t, bound)) ? O.some<Use[]>([...open(), { tag: "Goal", kappa: hole.kappa }]) : O.none),
		)
		.when(
			g => scoped(g, bound),
			g => {
				const selected = innermost(candidates, guards, g);
				return O.some(selected ? [...definitions, selected] : open());
			},
		)
		.otherwise(() => O.none);
};

const sameBinder = (a: IVL.Binder, b: IVL.Binder) => a.name === b.name && isEqual(a.sort, b.sort);
const distinct = (binders: readonly IVL.Binder[]) => uniqBy(binders, b => b.name).length === binders.length;

const discharged = (goal: IVL.Formula, guards: readonly IVL.Formula[], assumptions: readonly Assumption[]): boolean =>
	guards.some(p => isEqualWith(p, goal, ignoreOrigin)) ||
	match(goal)
		.with(Positive, ({ args: [hole] }) => assumptions.some(({ kappa, params }) => hole.kappa === kappa && isEqual(hole.spine, spine(params))))
		.with({ tag: "Atom", op: "=" }, ({ args: [a, b] }) => isEqual(a, b) && scoped(goal, () => true))
		.otherwise(() => false);

// Formula origins describe proof diagnostics. The same premise can reach its goal from a different source site.
const ignoreOrigin = (left: unknown, right: unknown): boolean | undefined =>
	isObject(left) && isObject(right) && ("origin" in left || "origin" in right)
		? isEqualWith(omit(left, "origin"), omit(right, "origin"), ignoreOrigin)
		: undefined;

const innermost = (candidates: Assumption[], guards: readonly IVL.Formula[], goal: IVL.Formula): Definition | undefined =>
	candidates.reduceRight<Definition | undefined>((selected, { kappa, params }) => {
		if (selected) {
			return selected;
		}
		const body = abstract(params, guards, goal);
		return body && { tag: "Definition", kappa, predicate: { params, body } };
	}, undefined);

const abstract = (params: IVL.Binder[], guards: readonly IVL.Formula[], goal: IVL.Formula): IVL.Formula | undefined => {
	const accepts = (v: IVL.Binder) => params.some(p => sameBinder(p, v));
	if (!scoped(goal, accepts)) {
		return undefined;
	}
	// A local equality v = key admits every key when v occurs only in this guard.
	const local = guards.filter(guard =>
		match(guard)
			.with(Alias, ({ args: [left, right] }) => {
				const elsewhere = [goal, ...guards.filter(g => g !== guard)];
				const isolated = (v: IVL.Binder) => !accepts(v) && elsewhere.every(f => scoped(f, other => other.name !== v.name));
				return !isEqual(left.sort, right.sort) || !(isolated(left) || isolated(right));
			})
			.otherwise(() => true),
	);
	if (!local.every(g => scoped(g, accepts))) {
		return undefined;
	}
	return local.length ? Build.implies(Build.and(...local), goal, goal.origin) : goal;
};

const scoped = (f: IVL.Formula, accepts: (v: IVL.Binder) => boolean): boolean =>
	match(f)
		.with(Patterns.Formula.And, Patterns.Formula.Or, ({ values }) => values.every(value => scoped(value, accepts)))
		.with(Patterns.Formula.Not, ({ value }) => scoped(value, accepts))
		.with(Patterns.Formula.Implies, ({ left, right }) => scoped(left, accepts) && scoped(right, accepts))
		.with(Patterns.Formula.Atom, ({ args }) => args.every(t => term(t, accepts)))
		.with(Patterns.Formula.True, Patterns.Formula.False, () => true)
		.otherwise(() => false);

const term = (t: IVL.Term, accepts: (v: IVL.Binder) => boolean): boolean =>
	match(t)
		.with(Patterns.Term.Var, accepts)
		.with(Patterns.Term.App, Patterns.Term.Arith, ({ args }) => args.every(arg => term(arg, accepts)))
		.with(Patterns.Term.Select, ({ array, index }) => term(array, accepts) && term(index, accepts))
		.with(Patterns.Term.Num, Patterns.Term.Str, Patterns.Term.Bool, Patterns.Term.Const, () => true)
		.otherwise(() => false);

const spine = (params: IVL.Binder[]) => params.map(p => Build.var_(p.name, p.sort));

const combine = (uses: Use[]): [IVL.Kappa, Predicate][] => {
	const definitions = uses.filter(u => isMatching({ tag: "Definition" }, u)).map(d => d.predicate);
	if (!definitions.length || uses.some(isMatching({ tag: "Open" }))) {
		return [];
	}
	const { params } = definitions[0];
	const signature = (p: Predicate) => p.params.map(v => v.sort);
	const sorts = signature(definitions[0]);
	if (!definitions.every(p => isEqual(signature(p), sorts))) {
		return [];
	}
	const args = spine(params);
	const bodies = definitions
		.filter(d => !isMatching(Patterns.Formula.True, d.body))
		.map(d => Substitute.formula(d.body, new Map(d.params.map((p, i) => [p.name, args[i]]))));
	if (!bodies.length && uses.some(isMatching({ tag: "Goal" }))) {
		return [];
	}
	return [[uses[0].kappa, { params, body: bodies.length === 1 ? bodies[0] : Build.and(...bodies) }]];
};
