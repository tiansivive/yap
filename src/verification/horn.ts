// Infer direct Horn preconditions from a verification condition (VC). Each concrete requirement
// belongs to the innermost assumed predicate whose arguments can express it.
// https://github.com/tiansivive/z-yap/blob/main/zettels/refinement-inference.md

import { groupBy, isEqual, isEqualWith, isObject, omit } from "lodash";
import { isMatching, match } from "ts-pattern";
import { Build, Patterns, type IVL } from "./solver/ivl";
import { interpret } from "./solver/ivl/interpret";

const Positive = { tag: "Atom", op: "=", args: [Patterns.Term.Hole, { tag: "Bool", value: true }] } as const;
const Equality = { tag: "Atom", op: "=", args: [Patterns.Term.Var, Patterns.Term.Var] } as const;

export namespace Horn {
	export type Predicate = { params: IVL.Binder[]; body: IVL.Formula };
	export type Assignment = ReadonlyMap<IVL.Kappa, Predicate>;

	export const infer = (vc: IVL.Formula): { formula: IVL.Formula; assignment: Assignment } => {
		const constraints = clauses(vc, [], []).map(requirements);
		const groups = constraints.every(c => c !== undefined) ? groupBy(constraints.flat(), c => c.kappa) : {};
		const definitions = Object.values(groups).flatMap(combine);
		const assignment: Assignment = new Map(definitions);
		return { formula: assignment.size ? instantiate(vc, assignment) : vc, assignment };
	};
}

type Clause = { readonly origin?: string; binders: IVL.Binder[]; assumptions: IVL.Formula[]; goal: IVL.Formula };

const clauses = (vc: IVL.Formula, binders: IVL.Binder[], assumptions: IVL.Formula[], origin = vc.origin): Clause[] =>
	match(vc)
		.with(Patterns.Formula.Forall, f => clauses(f.body, [...binders, ...f.binders], assumptions, f.origin ?? origin))
		.with(Patterns.Formula.And, f => f.values.flatMap(part => clauses(part, binders, assumptions, f.origin ?? origin)))
		.with(Patterns.Formula.Implies, f => clauses(f.right, binders, [...assumptions, ...conjuncts(f.left)], f.origin ?? origin))
		.otherwise(goal => [{ binders, assumptions, goal, origin: goal.origin ?? origin }]);

const conjuncts = (f: IVL.Formula): IVL.Formula[] =>
	match(f)
		.with(Patterns.Formula.And, ({ values }) => values.flatMap(conjuncts))
		.otherwise(() => [f]);

type Constraint = { kappa: IVL.Kappa; value: Horn.Predicate | "goal" | "open" };

const combine = (uses: Constraint[]): [IVL.Kappa, Horn.Predicate][] => {
	const predicates = uses.flatMap(c => (typeof c.value === "string" ? [] : [c.value]));

	if (!predicates.length || uses.some(c => c.value === "open")) {
		return [];
	}
	const { params } = predicates[0];
	const signature = (p: Horn.Predicate) => p.params.map(v => v.sort);
	const sorts = signature(predicates[0]);

	if (!predicates.every(p => isEqual(signature(p), sorts))) {
		return [];
	}
	const spine = params.map(p => Build.var_(p.name, p.sort));
	const bodies = predicates.filter(p => p.body.tag !== "True").map(p => apply(p, spine));

	if (!bodies.length && uses.some(c => c.value === "goal")) {
		return [];
	}
	return [[uses[0].kappa, { params, body: bodies.length === 1 ? bodies[0] : Build.and(...bodies) }]];
};

const requirements = ({ binders, assumptions, goal, origin }: Clause): Constraint[] | undefined => {
	const premise = assumptions.filter(f => isMatching(Positive, f)).map(f => f.args[0]);
	const open: Constraint[] = premise.map(({ kappa }) => ({ kappa, value: "open" }));
	const guards = assumptions.filter(f => !isMatching(Positive, f));
	const bound = (v: IVL.Binder) => binders.some(b => b.name === v.name && isEqual(b.sort, v.sort));
	const candidates = premise.flatMap(({ kappa, spine }) => {
		const params = spine.flatMap(arg =>
			match(arg)
				.with(Patterns.Term.Var, v => (bound(v) ? [{ name: v.name, sort: v.sort }] : []))
				.otherwise(() => []),
		);
		return params.length === spine.length && new Set(params.map(p => p.name)).size === params.length ? [{ kappa, value: { params, body: Build.true_() } }] : [];
	});
	if (candidates.length !== premise.length || new Set(binders.map(b => b.name)).size !== binders.length || !guards.every(g => scoped(g, bound))) {
		return undefined;
	}
	const reflexive = match(goal)
		.with(Positive, ({ args: [hole] }) => premise.some(h => isEqual(h, hole)))
		.with({ tag: "Atom", op: "=" }, ({ args: [a, b] }) => isEqual(a, b) && scoped(goal, () => true))
		.with(Patterns.Formula.True, () => true)
		.otherwise(() => false);
	if (reflexive || guards.some(g => isEqualWith(g, goal, ignoreOrigin))) {
		return candidates;
	}
	if (isMatching(Positive, goal)) {
		const [hole] = goal.args;
		return hole.spine.every(t => term(t, bound)) ? [...open, { kappa: hole.kappa, value: "goal" }] : undefined;
	}

	if (!scoped(goal, bound)) {
		return undefined;
	}
	const selected = candidates
		.map(({ kappa, value: { params } }) => ({ kappa, params, body: abstract(params, guards, goal, origin) }))
		.findLast(d => d.body !== undefined);
	return selected?.body ? [...candidates, { kappa: selected.kappa, value: { params: selected.params, body: selected.body } }] : open;
};

const ignoreOrigin = (left: unknown, right: unknown): boolean | undefined =>
	isObject(left) && isObject(right) && ("origin" in left || "origin" in right)
		? isEqualWith(omit(left, "origin"), omit(right, "origin"), ignoreOrigin)
		: undefined;

const abstract = (params: IVL.Binder[], guards: IVL.Formula[], goal: IVL.Formula, origin?: string): IVL.Formula | undefined => {
	const accepts = (v: IVL.Binder) => params.some(p => p.name === v.name && isEqual(p.sort, v.sort));

	if (!scoped(goal, accepts)) {
		return undefined;
	}
	const local = guards.filter(g => {
		// An equality v = key admits every key when v is quantified and occurs only in this guard.
		const elsewhere = [goal, ...guards.filter(other => other !== g)];
		return !match(g)
			.with(
				Equality,
				({ args: [a, b] }) => isEqual(a.sort, b.sort) && [a, b].some(v => !accepts(v) && elsewhere.every(f => scoped(f, other => other.name !== v.name))),
			)
			.otherwise(() => false);
	});

	if (!local.every(g => scoped(g, accepts))) {
		return undefined;
	}
	return local.length ? Build.implies(Build.and(...local), goal, origin) : { ...goal, origin };
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

const apply = ({ params, body }: Horn.Predicate, spine: IVL.Term[]): IVL.Formula =>
	interpret(body, new Map(params.map((param, index) => [param.name, spine[index]])));

const instantiate = (f: IVL.Formula, assignment: Horn.Assignment): IVL.Formula =>
	match(f)
		.with(Positive, ({ args: [hole] }) => {
			const definition = assignment.get(hole.kappa);

			if (!definition || definition.params.length !== hole.spine.length) {
				return f;
			}
			const body = apply(definition, hole.spine);
			return { ...body, origin: f.origin ?? body.origin };
		})
		.with(Patterns.Formula.Forall, q => Build.forall(q.binders, instantiate(q.body, assignment), q.origin, q.triggers))
		.with(Patterns.Formula.Implies, p => Build.implies(instantiate(p.left, assignment), instantiate(p.right, assignment), p.origin))
		.with(Patterns.Formula.And, p =>
			Build.andWithOrigin(
				p.values.map(v => instantiate(v, assignment)),
				p.origin,
			),
		)
		.otherwise(() => f);
