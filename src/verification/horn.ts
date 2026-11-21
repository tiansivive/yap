// Direct Horn inference over the predicate values produced by bidirectional verification.
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { OP_AND, OP_EQ } from "@yap/shared/lib/primitives";
import * as Eff from "@yap/utils/effects";
import { isEqualWith, groupBy } from "lodash";
import { isMatching, match } from "ts-pattern";
import { definitions, reader, type Definitions, type Verification } from "./V2/effects";

export type Binder = { level?: number; premise?: NF.Value };
export type Constraint = { binders: readonly Binder[]; goal: NF.Value };
type Hole = { id: number; args: NF.Value[] };
type Use = { id: number; tag: "Default" | "Goal" | "Open" } | { id: number; tag: "Definition"; body: EB.Term };

export function* solve(clauses: readonly Constraint[], owned: ReadonlySet<number>): Verification<ReadonlyMap<number, NF.Value>> {
	const registry = yield* Metas.registry.get();
	const uses = (yield* Eff.traverse(clauses, c => requirements(c, registry, owned))).flat();
	const definitions = Object.values(groupBy(uses, "id"));
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

/** Retained computations bind their result symbols in the predicate's own scope. */
export function* prepare(v: NF.Value, defs: Definitions = new Map()): Verification<NF.Value> {
	const head = yield* NF.force(v);
	if (isMatching(NF.Patterns.Glued, head)) {
		return NF.Constructors.Glued(yield* prepare(head.folded, defs), yield* prepare(head.unfolded, defs));
	}
	const { value } = yield* NF.view(head);
	return yield* match(value)
		.with(NF.Patterns.Existential, function* (ex) {
			const bindings = definitions.extend(ex.assumptions)(defs);
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

function* requirements({ binders, goal }: Constraint, registry: Metas.Registry, owned: ReadonlySet<number>): Verification<Use[]> {
	const premises = binders.flatMap(b => (b.premise ? conjuncts(b.premise) : []));

	if (premises.some(p => isMatching(truth(false), peek(p)))) {
		return [];
	}
	const levels = binders.flatMap(b => (b.level === undefined ? [] : [b.level]));
	const assumptions = premises.flatMap(p => {
		const h = hole(p, registry);
		const spine = h?.args.map(level);
		return h && spine && spine.every((l): l is number => l !== undefined) ? [{ id: h.id, params: spine, premise: p }] : [];
	});
	const candidates = assumptions.filter(a => owned.has(a.id));
	const concrete = premises.filter(p => !assumptions.some(a => p === a.premise) && !isMatching(truth(true), peek(p)));
	const defaults: Use[] = candidates.map(({ id }) => ({ id, tag: "Default" }));
	const open: Use[] = candidates.map(({ id }) => ({ id, tag: "Open" }));
	const g = peek(goal);

	if (isMatching(truth(true), g)) {
		return defaults;
	}

	if (new Set(levels).size !== levels.length || assumptions.some(a => new Set(a.params).size !== a.params.length || !a.params.every(l => levels.includes(l)))) {
		return open;
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
	const guards = concrete.filter(p => {
		const eq = peek(p);
		return !(isMatching(equality, eq) && same(eq.args[0], eq.args[1]));
	});

	if (guards.some(p => same(p, goal)) || (isMatching(equality, g) && same(g.args[0], g.args[1]))) {
		return defaults;
	}
	const h = hole(goal, registry);
	if (h) {
		if (assumptions.some(a => a.id === h.id && a.params.length === h.args.length && a.params.every((l, i) => l === level(h.args[i])))) {
			return defaults;
		}
		return [...open, { id: h.id, tag: "Goal" }];
	}

	if (!read(goal, l => (levels.includes(l) ? l : undefined)) || guards.some(p => !read(p, l => (levels.includes(l) ? l : undefined)))) {
		return open;
	}
	const selected = candidates.reduceRight<Use | undefined>((selected, { id, params }) => {
		if (selected) {
			return selected;
		}
		const rename = (l: number) => (params.includes(l) ? params.length - 1 - params.indexOf(l) : undefined);
		const rhs = read(goal, rename);

		if (!rhs) {
			return undefined;
		}
		const retained = guards.filter(p => {
			const eq = peek(p);

			if (!isMatching(equality, eq)) {
				return true;
			}
			return !eq.args.some(v => {
				const local = level(v);
				return (
					local !== undefined &&
					!params.includes(local) &&
					[...eq.args.filter(arg => arg !== v), goal, ...guards.filter(g => g !== p)].every(other => read(other, l => (l === local ? undefined : l)))
				);
			});
		});
		const conditions = retained.map(p => read(p, rename));
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
