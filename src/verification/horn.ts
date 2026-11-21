// Direct Horn inference assigns each concrete goal to the innermost assumed predicate
// whose formal parameters can express it. IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/refinement-inference.md

import { groupBy, isEqual, isEqualWith, isObject, omit } from "lodash";
import { isMatching, match } from "ts-pattern";
import { Build, Patterns, type IVL } from "./solver/ivl";
import { Substitute } from "./solver/ivl/substitute";

const Positive = { tag: "Atom", op: "=", args: [Patterns.Term.Hole, { tag: "Bool", value: true }] } as const;
const Alias = { tag: "Atom", op: "=", args: [Patterns.Term.Var, Patterns.Term.Var] } as const;

export namespace Horn {
	export type Frame = { tag: "forall"; binder: IVL.Binder } | { tag: "assume"; predicate: IVL.Formula };
	export type Constraint = { scope: readonly Frame[]; goal: IVL.Formula; readonly origin?: string };
	export type Predicate = { params: IVL.Binder[]; body: IVL.Formula };
	export type Assignment = ReadonlyMap<IVL.Kappa, Predicate>;

	export const solve = (constraints: readonly Constraint[]): Assignment => {
		const uses = constraints.flatMap(requirements);
		if (!uses.every(use => use !== undefined)) {
			return new Map();
		}
		return new Map(Object.values(groupBy(uses, use => use.kappa)).flatMap(combine));
	};

	type Use = { kappa: IVL.Kappa; value: Predicate | "open" | "goal" };

	const requirements = ({ scope, goal, origin }: Constraint): (Use | undefined)[] => {
		const binders = scope.filter(f => f.tag === "forall").map(f => f.binder);
		const premises = scope.filter(f => f.tag === "assume").flatMap(f => conjuncts(f.predicate));
		if (premises.some(f => isMatching(Patterns.Formula.False, f))) {
			return [];
		}
		const holes = premises.filter(f => isMatching(Positive, f)).map(f => f.args[0]);
		const guards = premises.filter(f => !isMatching(Positive, f) && !isMatching(Patterns.Formula.True, f));
		const bound = (v: IVL.Binder) => binders.some(b => b.name === v.name && isEqual(b.sort, v.sort));
		const candidates = holes.flatMap(({ kappa, spine }) => {
			const params = spine.filter(t => isMatching(Patterns.Term.Var, t)).map(({ name, sort }) => ({ name, sort }));
			return params.length === spine.length && params.every(bound) && new Set(params.map(p => p.name)).size === params.length
				? [{ kappa, value: { params, body: Build.true_() } }]
				: [];
		});
		if (candidates.length !== holes.length || new Set(binders.map(b => b.name)).size !== binders.length || !guards.every(g => scoped(g, bound))) {
			return [undefined];
		}

		const open: Use[] = holes.map(({ kappa }) => ({ kappa, value: "open" }));
		return conjuncts(goal).flatMap((part): (Use | undefined)[] => {
			const reflexive = match(part)
				.with(Positive, ({ args: [hole] }) => holes.some(h => isEqual(h, hole)))
				.with({ tag: "Atom", op: "=" }, ({ args: [a, b] }) => isEqual(a, b) && scoped(part, () => true))
				.with(Patterns.Formula.True, () => true)
				.otherwise(() => false);
			if (reflexive || guards.some(g => isEqualWith(g, part, ignoreOrigin))) {
				return candidates;
			}
			if (isMatching(Positive, part)) {
				const [hole] = part.args;
				return hole.spine.every(t => term(t, bound)) ? [...open, { kappa: hole.kappa, value: "goal" }] : [undefined];
			}
			if (!scoped(part, bound)) {
				return [undefined];
			}
			const selected = candidates
				.map(({ kappa, value: { params } }) => ({ kappa, params, body: abstract(params, guards, part, part.origin ?? goal.origin ?? origin) }))
				.findLast(p => p.body !== undefined);
			return selected?.body ? [...candidates, { kappa: selected.kappa, value: { params: selected.params, body: selected.body } }] : open;
		});
	};

	const conjuncts = (formula: IVL.Formula): IVL.Formula[] =>
		match(formula)
			.with(Patterns.Formula.And, ({ values }) => values.flatMap(conjuncts))
			.otherwise(f => [f]);

	const ignoreOrigin = (left: unknown, right: unknown): boolean | undefined =>
		isObject(left) && isObject(right) && ("origin" in left || "origin" in right)
			? isEqualWith(omit(left, "origin"), omit(right, "origin"), ignoreOrigin)
			: undefined;

	const abstract = (params: IVL.Binder[], guards: IVL.Formula[], goal: IVL.Formula, origin?: string): IVL.Formula | undefined => {
		const accepts = (v: IVL.Binder) => params.some(p => p.name === v.name && isEqual(p.sort, v.sort));
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

	const combine = (uses: Use[]): [IVL.Kappa, Predicate][] => {
		const definitions = uses.flatMap(({ value }) => (typeof value === "string" ? [] : [value]));
		if (!definitions.length || uses.some(u => u.value === "open")) {
			return [];
		}
		const { params } = definitions[0];
		const signature = (p: Predicate) => p.params.map(v => v.sort);
		const sorts = signature(definitions[0]);
		if (!definitions.every(p => isEqual(signature(p), sorts))) {
			return [];
		}
		const spine = params.map(p => Build.var_(p.name, p.sort));
		const bodies = definitions
			.filter(d => !isMatching(Patterns.Formula.True, d.body))
			.map(d => Substitute.formula(d.body, new Map(d.params.map((p, i) => [p.name, spine[i]]))));
		if (!bodies.length && uses.some(u => u.value === "goal")) {
			return [];
		}
		return [[uses[0].kappa, { params, body: bodies.length === 1 ? bodies[0] : Build.and(...bodies) }]];
	};
}
