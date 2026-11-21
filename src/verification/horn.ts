// Each concrete goal belongs to the innermost assumed predicate whose arguments can express it.
// https://github.com/tiansivive/z-yap/blob/main/zettels/refinement-inference.md
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { OP_AND, OP_EQ } from "@yap/shared/lib/primitives";
import * as Eff from "@yap/utils/effects";
import { isEqualWith, groupBy } from "lodash";
import { isMatching, match } from "ts-pattern";
import { reader, run, type Verification } from "./V2/effects";
import type { IVL } from "./solver/ivl/types";
import { predicate } from "./V2/logic/translate";

export type Predicate = { params: IVL.Binder[]; body: IVL.Formula };
export type Assignment = ReadonlyMap<IVL.Kappa, Predicate>;

/** Validity consumes IVL assignments at the end of verification. */
export function assignment(clauses: readonly Constraint[], ctx: EB.Context, registry: Metas.Registry): Assignment {
	const { answer } = run(ctx, registry, function* () {
		const solutions = yield* solve(clauses);
		const entries = yield* Eff.traverse([...solutions], function* ([id, value]) {
			return [id, yield* predicate(value)] as const;
		});
		return new Map(entries);
	});
	if (Eff.failed(answer)) {
		throw new Error("Horn predicate translation failed", { cause: answer[Eff.ABORT] });
	}
	return answer;
}

export type Binder = { level: number; premise?: NF.Value };
export type Constraint = { binders: readonly Binder[]; goal: NF.Value };
type Hole = { id: number; args: NF.Value[] };
type Use = { id: number; tag: "Default" | "Goal" | "Open" } | { id: number; tag: "Definition"; body: EB.Term };

export function* solve(clauses: readonly Constraint[]): Verification<ReadonlyMap<number, NF.Value>> {
	const registry = yield* Metas.registry.get();
	const requirementsByClause = yield* Eff.traverse(clauses, c => requirements(c, registry));
	if (!requirementsByClause.every((uses): uses is Use[] => uses !== undefined)) {
		return new Map();
	}
	const definitions = Object.values(groupBy(requirementsByClause.flat(), "id"));
	const solutions = yield* Eff.traverse(definitions, function* (group): Verification<[number, NF.Value][]> {
		const { id } = group[0];
		const bodies = group.flatMap(u => (u.tag === "Definition" ? [u.body] : []));

		if (group.some(u => u.tag === "Open") || (!bodies.length && group.some(u => u.tag === "Goal"))) {
			return [];
		}
		const body = bodies.length ? bodies.reduce(EB.DSL.and) : EB.DSL.bool(true);
		const type = Metas.entry(registry, id).annotation;
		const value = yield* lambda(type, body);
		return [[id, value]];
	});
	return new Map(solutions.flat());
}

type Definitions = ReadonlyMap<number, { value: NF.Value; env: Definitions }>;

/** Retained computations bind their result symbols in the predicate's own scope. */
export function* prepare(v: NF.Value, defs: Definitions = new Map()): Verification<NF.Value> {
	const head = yield* NF.force(v);
	if (isMatching(NF.Patterns.Glued, head)) {
		return NF.Constructors.Glued(yield* prepare(head.folded, defs), yield* prepare(head.unfolded, defs));
	}
	const { value } = yield* NF.view(head);
	return yield* match(value)
		.with(NF.Patterns.Existential, function* (ex) {
			const bindings = [...ex.assumptions].reduce<Definitions>((env, [v, rhs]) => new Map([...env, [v.lvl, { value: rhs, env }]]), defs);
			return yield* prepare(ex.body.value, bindings);
		})
		.with(NF.Patterns.Rigid, function* ({ variable }) {
			const rhs = defs.get(variable.lvl);
			return rhs ? yield* prepare(rhs.value, rhs.env) : value;
		})
		.with(NF.Patterns.Neutral, ({ value }) => prepare(value, defs))
		.with(NF.Patterns.App, function* ({ func, arg, icit }) {
			return NF.Constructors.App(yield* prepare(func, defs), yield* prepare(arg, defs), icit);
		})
		.with(NF.Patterns.External, function* (external) {
			const args = yield* Eff.traverse(external.args, arg => prepare(arg, defs));
			return NF.Constructors.External(external.name, external.arity, external.compute, args);
		})
		.with(NF.Patterns.Proj, function* ({ base, label }) {
			return NF.Constructors.Proj(yield* prepare(base, defs), label);
		})
		.otherwise(() => Eff.of(value));
}

const peek = (v: NF.Value) => NF.unwrapNeutral(NF.unglue(v));
const truth = (value: boolean) => ({ type: "Lit", value: { type: "Bool", value } }) as const;
const equality = { ...NF.Patterns.External, name: OP_EQ } as const;

export const conjuncts = (value: NF.Value): NF.Value[] =>
	match(peek(value))
		.with({ ...NF.Patterns.External, name: OP_AND }, ({ args }) => args.flatMap(conjuncts))
		.otherwise(() => [value]);

const hole = (v: NF.Value, registry: Metas.Registry, args: NF.Value[] = []): Hole | undefined =>
	match(peek(v))
		.with(NF.Patterns.App, app => hole(app.func, registry, [app.arg, ...args]))
		.with(NF.Patterns.Flex, ({ variable }) => (Metas.lookup(registry, variable.val)?.kind === "Predicate" ? { id: variable.val, args } : undefined))
		.otherwise(() => undefined);

const level = (v: NF.Value) =>
	match(peek(v))
		.with(NF.Patterns.Rigid, x => x.variable.lvl)
		.otherwise(() => undefined);

function* requirements({ binders, goal }: Constraint, registry: Metas.Registry): Verification<Use[] | undefined> {
	const premises = binders.flatMap(b => (b.premise ? conjuncts(b.premise) : []));

	if (premises.some(p => isMatching(truth(false), peek(p)))) {
		return [];
	}
	const levels = binders.map(b => b.level);
	const assumptions = premises.flatMap(premise => {
		const h = hole(premise, registry);
		const params = h?.args.map(level);
		return h && params?.every((l): l is number => l !== undefined) ? [{ id: h.id, params, premise }] : [];
	});
	const candidates = assumptions.filter(({ params }) => new Set(params).size === params.length && params.every(l => levels.includes(l)));
	const concrete = premises.filter(p => !assumptions.some(a => p === a.premise) && !isMatching(truth(true), peek(p)));
	const defaults: Use[] = candidates.map(({ id }) => ({ id, tag: "Default" }));
	const open: Use[] = candidates.map(({ id }) => ({ id, tag: "Open" }));
	const g = peek(goal);

	if (isMatching(truth(true), g)) {
		return defaults;
	}

	if (new Set(levels).size !== levels.length || candidates.length !== assumptions.length) {
		return undefined;
	}
	const depth = Math.max((yield* reader.ask()).env.length, ...levels.map(l => l + 1));
	const terms = [goal, ...concrete];
	const operands = terms.flatMap(p => {
		const eq = peek(p);
		return isMatching(equality, eq) ? eq.args : [];
	});
	const quotes = new Map(
		yield* Eff.traverse([...new Set([...terms, ...operands])], function* (p) {
			return [p, yield* NF.quote(depth, p)] as const;
		}),
	);
	const read = (p: NF.Value, index: (level: number) => number | undefined) => {
		const tm = quotes.get(p);
		return tm && rename(tm, depth, index);
	};
	const same = (a: NF.Value, b: NF.Value) => isEqualWith(quotes.get(a), quotes.get(b), (_a, _b, key) => (key === "id" ? true : undefined));
	const inScope = (l: number) => (levels.includes(l) ? l : undefined);
	if (concrete.some(p => !read(p, inScope))) {
		return undefined;
	}
	const guards = concrete.filter(p => {
		const eq = peek(p);
		return !(isMatching(equality, eq) && same(eq.args[0], eq.args[1]));
	});

	if (guards.some(p => same(p, goal)) || (isMatching(equality, g) && same(g.args[0], g.args[1]))) {
		return defaults;
	}
	const h = hole(goal, registry);
	if (h) {
		const args = yield* Eff.traverse(h.args, a => NF.quote(depth, a));
		if (!args.every(a => rename(a, depth, inScope))) {
			return undefined;
		}
		if (candidates.some(a => a.id === h.id && a.params.length === h.args.length && a.params.every((l, i) => l === level(h.args[i])))) {
			return defaults;
		}
		return [...open, { id: h.id, tag: "Goal" }];
	}

	if (!read(goal, inScope)) {
		return undefined;
	}
	const selected = candidates.reduceRight<Use | undefined>((selected, { id, params }) => {
		if (selected) {
			return selected;
		}
		const formal = (l: number) => (params.includes(l) ? params.length - 1 - params.indexOf(l) : undefined);
		const rhs = read(goal, formal);

		if (!rhs) {
			return undefined;
		}
		const retained = guards.filter(p => {
			const eq = peek(p);

			if (!isMatching(equality, eq)) {
				return true;
			}
			const locals = eq.args.map(level);
			if (!locals.every((l): l is number => l !== undefined)) {
				return true;
			}
			const elsewhere = [goal, ...guards.filter(g => g !== p)];
			return !locals.some(local => !params.includes(local) && elsewhere.every(other => read(other, l => (l === local ? undefined : l))));
		});
		const conditions = retained.map(p => read(p, formal));
		if (conditions.every((p): p is EB.Term => !!p)) {
			const body = conditions.length ? EB.DSL.or(EB.DSL.not(conditions.reduce(EB.DSL.and)), rhs) : rhs;
			return { id, tag: "Definition", body };
		}
		return undefined;
	}, undefined);
	return selected ? [...defaults, selected] : open;
}

/* Only variables in the selected spine acquire indices in the new lambda body. */
function rename(tm: EB.Term, depth: number, index: (level: number) => number | undefined, local = 0): EB.Term | undefined {
	const recur = (v: EB.Term) => rename(v, depth, index, local);
	return match(tm)
		.with(EB.CtorPatterns.Vars.Bound, ({ variable }) => {
			if (variable.index < local) {
				return tm;
			}
			const i = index(depth + local - variable.index - 1);
			return i === undefined ? undefined : EB.DSL.bound(local + i);
		})
		.with({ type: "Var", variable: { type: "Free" } }, EB.CtorPatterns.Vars.Foreign, EB.CtorPatterns.Lit, () => tm)
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const f = recur(func),
				x = recur(arg);
			return f && x && EB.Constructors.App(icit, f, x);
		})
		.with(EB.CtorPatterns.Proj, ({ term, label }) => {
			const record = recur(term);
			return record && EB.Constructors.Proj(label, record);
		})
		.with({ type: "Modal" }, ({ term, modalities }) => {
			const inner = recur(term),
				liquid = recur(modalities.liquid);
			return inner && liquid && EB.Constructors.Modal(inner, { ...modalities, liquid });
		})
		.with(EB.CtorPatterns.Lambda, EB.CtorPatterns.Pi, ({ binding, body }) => {
			const annotation = recur(binding.annotation),
				inner = rename(body, depth, index, local + 1);
			return annotation && inner && EB.Constructors.Abs({ ...binding, annotation }, inner);
		})
		.otherwise(() => undefined);
}

function* lambda(type: NF.Value, body: EB.Term): Verification<NF.Value> {
	const abstraction = function* (ty: NF.Value): Verification<EB.Term> {
		const head = yield* NF.view(ty);

		if (!isMatching(NF.View.Sealed(NF.Patterns.Pi), head)) {
			return body;
		}
		const { binder, closure } = head.value;
		const outer = yield* reader.ask();
		const annotated = yield* NF.quote(outer.env.length, binder.annotation);
		const next = yield* NF.apply(binder, closure, NF.Constructors.Rigid(outer.env.length));
		const nested = yield* reader.local(c => EB.bind(c, binder, binder.annotation), abstraction(next));
		return EB.Constructors.Lambda(binder.variable, binder.icit, nested, annotated);
	};
	return yield* NF.evaluate(yield* abstraction(type));
}
