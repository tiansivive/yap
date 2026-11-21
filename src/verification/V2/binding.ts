import { isMatching, match } from "ts-pattern";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Eff from "@yap/utils/effects";
import * as Horn from "../horn";
import { Build } from "../solver/ivl/build";
import { Validity } from "../validity";
import { check } from "./check";
import { constraints, hypotheses, reader, type Verification } from "./effects";
import type { VerificationArtefacts } from "./types";

export function* binding(term: EB.Term, type: NF.Value, boundary: "local" | "declaration"): Verification<VerificationArtefacts> {
	const local = new Set(inputs(term));
	if (!local.size) {
		return yield* check(term, type);
	}
	const [result, clauses] = yield* Eff.with([constraints.handlers()], () => check(term, type));
	const registry = yield* Metas.registry.get();
	const outer = yield* hypotheses.ask();

	// The binding can publish requirements proved from its own inputs. The enclosing scope still verifies any remaining clauses.
	const assignment = Horn.solve(
		clauses.map(c => ({
			...c,
			assumptions: c.assumptions.filter(a => local.has(a.kappa) && !outer.assumptions.some(other => other.kappa === a.kappa)),
			guards: c.guards.filter(g => !outer.guards.includes(g)),
		})),
	);
	if (assignment.size && Validity.check(result.vc, assignment).tag === "valid") {
		const solutions = yield* Eff.traverse([...assignment], function* ([id, predicate]) {
			const entry = Metas.entry(registry, id);
			const value = yield* solution(predicate, entry);
			return [id, value] as const;
		});
		if (solutions.every((item): item is readonly [number, NF.Value] => item[1] !== undefined)) {
			yield* Metas.registry.modify(m => solutions.reduce((acc, [id, value]) => Metas.solve(acc, id, value), m));

			if (boundary === "local") {
				return { ...result, vc: Build.true_() };
			}
		}
	}
	yield* constraints.tell(clauses);
	return result;
}

const inputs = (term: EB.Term): number[] =>
	match(term)
		.with(EB.CtorPatterns.Psi, ({ binding, body }) => [...id(binding.requirement), ...inputs(body)])
		.with(EB.CtorPatterns.Lambda, ({ binding, body }) => [
			...id(binding.annotation.type === "Modal" ? binding.annotation.modalities.liquid : undefined),
			...inputs(body),
		])
		.with(EB.CtorPatterns.Ann, ({ term }) => inputs(term))
		.otherwise(() => []);

const id = (term?: EB.Term) => (isMatching(EB.CtorPatterns.Vars.Meta, term) ? [term.variable.val] : []);

export function* solution(predicate: Horn.Predicate, entry: Pick<Metas.Entry, "annotation" | "meta">): Verification<NF.Value | undefined> {
	const parts = yield* Eff.traverse(predicate.parts ?? [], function* ({ params, guards, goal }) {
		const conclusion = yield* abstract(goal, params);
		const premises = yield* Eff.traverse(guards, source => abstract(source, params));
		if (!conclusion || !premises.every(g => g !== undefined)) {
			return undefined;
		}
		return premises.length ? EB.DSL.or(EB.DSL.not(premises.reduce(EB.DSL.and)), conclusion) : conclusion;
	});
	if ((!parts.length && predicate.body.tag !== "True") || !parts.every(part => part !== undefined)) {
		return undefined;
	}
	const body = parts.length ? parts.reduce(EB.DSL.and) : EB.DSL.bool(true);
	const close = function* (annotation: NF.Value, position: number): Verification<EB.Term | undefined> {
		if (position === predicate.params.length) {
			return body;
		}
		const view = yield* NF.view(annotation);
		if (!isMatching(NF.View.Sealed(NF.Patterns.Pi), view)) {
			return undefined;
		}
		const { binder, closure } = view.value;
		const level = entry.meta.lvl + position;
		const name = predicate.params[position].name;
		const domain = rename(yield* NF.quote(level, binder.annotation), index => (index >= 0 && index < position ? index : undefined));
		const result = yield* NF.apply(binder, closure, NF.Constructors.Rigid(level));
		const inner = yield* reader.local(c => EB.bind(c, binder, binder.annotation), close(result, position + 1));
		return domain && inner && EB.Constructors.Lambda(name, binder.icit, inner, domain);
	};
	const term = yield* close(entry.annotation, 0);
	return term && (yield* NF.evaluate(term));
}

function* abstract(source: Horn.Source, params: Horn.Part["params"]): Verification<EB.Term | undefined> {
	const depth = source.ctx.env.length;
	const original = yield* reader.local(() => source.ctx, NF.quote(depth, source.value));
	return rename(original, index => {
		const name = source.names.get(depth - index - 1);
		const position = params.findIndex(p => p.name === name);
		return position >= 0 ? params.length - position - 1 : undefined;
	});
}

/* The partial map describes the outer scope. Each nested binder introduces an index that belongs to the retained term. */
function rename(term: EB.Term, at: (index: number) => number | undefined, inside = 0): EB.Term | undefined {
	return match(term)
		.with(EB.CtorPatterns.Lit, EB.CtorPatterns.Vars.Foreign, { type: "Var", variable: { type: "Free" } }, term => term)
		.with(EB.CtorPatterns.Vars.Bound, ({ variable: { index } }) => {
			if (index >= 0 && index < inside) {
				return EB.DSL.bound(index);
			}
			const target = at(index - inside);
			return target === undefined ? undefined : EB.DSL.bound(inside + target);
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const fn = rename(func, at, inside);
			const value = rename(arg, at, inside);
			return fn && value && EB.Constructors.App(icit, fn, value);
		})
		.with({ type: "Proj" }, ({ label, term }) => {
			const base = rename(term, at, inside);
			return base && EB.Constructors.Proj(label, base);
		})
		.with(EB.CtorPatterns.Lambda, EB.CtorPatterns.Pi, ({ binding, body }) => {
			const annotation = rename(binding.annotation, at, inside);
			const inner = rename(body, at, inside + 1);
			return annotation && inner && EB.Constructors.Abs({ ...binding, annotation }, inner);
		})
		.with({ type: "Modal" }, ({ term, modalities }) => {
			const base = rename(term, at, inside);
			const liquid = rename(modalities.liquid, at, inside);
			return base && liquid && EB.Constructors.Modal(base, { ...modalities, liquid });
		})
		.otherwise(() => undefined);
}
