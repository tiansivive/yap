import { match } from "ts-pattern";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Src from "@yap/src/index";
import * as Metas from "@yap/elaboration/shared/metas";

const C = EB.Constructors;
const Effect = { type: "App", func: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Effect" } } } } as const;
export const anonymous = NF.Constructors.Atom("$anonymous");

export function* infer(node: Extract<Src.Term, { type: "with" }>): M.Elaboration<EB.AST> {
	const [clause, ...rest] = node.handlers;
	if (!clause) return yield* EB.infer(node.term);
	const ctx = yield* M.reader.ask();
	const local = match(clause.identity)
		.with({ type: "var", variable: { type: "name" } }, ({ variable }) =>
			ctx.imports[variable.value] || ctx.env.some(e => e.name.variable === variable.value) ? undefined : variable.value)
		.otherwise(() => undefined);
	const P = yield* fresh();
	const R = yield* fresh();
	const atom = local ? NF.Constructors.Atom(`${local}$effect${yield* M.supply.fresh("skolem")}`) : undefined;
	const extended = local && atom ? { ...ctx, imports: { ...ctx.imports, [local]: [yield* NF.quote(ctx.env.length, atom), effect(P, R), []] satisfies EB.AST } } : ctx;

	return yield* M.reader.local(() => extended, (function* (): M.Elaboration<EB.AST> {
		const resolved = yield* identity(clause.identity);
		const [payload, result] = yield* signature(resolved.carrier, true);
		const answer = yield* fresh();
		const handlerType = yield* arrow(payload, yield* arrow(yield* arrow(result, answer), answer));
		const [[handler, body, usages], { constraints }] = yield* M.writer.listen((function* () {
			const [handler] = yield* M.reader.local(c => ({ ...c, controlHandler: true }), EB.check(clause.handler, handlerType));
			const [body, usages] = yield* M.reader.local(c => ({ ...c, implicits: [[resolved.atom, resolved.atom], ...c.implicits] }),
				EB.check(rest.length ? { ...node, handlers: rest } : node.term, answer));
			return [handler, body, usages] as const;
		})());
		const { resolutions } = yield* EB.solve(constraints);
		if (atom) {
			const type = yield* NF.quote(ctx.env.length, yield* NF.force(answer));
			const escaped: string[] = [];
			EB.rewrite(type, t => {
				if (t.type === "Lit" && t.value.type === "Atom" && t.value.value === name(atom)) escaped.push(local!);
				return t;
			});
			if (escaped.length) throw new Error(`Local effect identity ${local} escapes in the result type`);
		}
		const tm = C.Reset(yield* EB.Icit.instantiate(body, resolutions), resolved.term, deep(yield* EB.Icit.instantiate(handler, resolutions)));
		return [tm, yield* NF.force(answer), usages];
	})());
}

export function* capture(node: Extract<Src.Term, { type: "capture" }>): M.Elaboration<EB.AST> {
	if (!node.identity) return yield* raw(node);
	const ctx = yield* M.reader.ask();
	const resolved = yield* identity(node.identity);
	const [payload, result] = yield* signature(resolved.carrier);
	const [value, usages] = yield* EB.check(node.term, payload);
	const token = resolved.evidence ? resolved.term : yield* evidence(resolved.atom);
	const meta = yield* EB.freshMeta(ctx.env.length, result);
	return [C.Bubble(meta.val, result, [], C.Capture(token, value)), result, usages];
}

function* raw(node: Extract<Src.Term, { type: "capture" }>): M.Elaboration<EB.AST> {
	const ctx = yield* M.reader.ask();
	const { delimitations } = yield* M.st.get();
	const outer = delimitations[0];
	const inFunction = ctx.env.slice(0, ctx.env.length - (outer?.level ?? 0)).some(e => e.name.type === "Lambda");
	if (!outer && !inFunction) throw new Error("Anonymous capture requires an enclosing reset");
	const answer = inFunction ? yield* fresh() : undefined;
	const delimitation = answer ? { answer: { initial: answer, final: answer }, shifted: false, level: ctx.env.length } : outer;
	if (answer) yield* M.st.modify(s => ({ ...s, delimitations: [delimitation, ...s.delimitations] }));
	const result = yield* fresh();
	const meta = yield* EB.freshMeta(ctx.env.length, result);
	const next = answer ?? (yield* fresh());
	const kType = yield* arrow(result, next);
	const handlerAnswer = delimitation.next ?? delimitation.answer.final;
	const variable = node.term.type === "lambda" ? node.term.variable : "$k";
	// The handler runs outside this delimiter; its captures see the enclosing reset.
	yield* M.st.modify(s => ({ ...s, delimitations: s.delimitations.slice(1) }));
	const [payload, usages] = node.term.type === "lambda"
		? yield* M.reader.local(c => EB.bind(c, { type: "Continuation", variable, resumption: { meta }, deep: true }, kType), EB.check(node.term.body, handlerAnswer))
		: yield* EB.check(node.term, yield* arrow(kType, handlerAnswer));
	if (!answer) yield* M.st.modify(s => ({ ...s, delimitations: [{ ...delimitation, shifted: true, next }, ...s.delimitations] }));
	const body = node.term.type === "lambda" ? C.Lambda(variable, "Explicit", payload, yield* NF.quote(ctx.env.length, kType)) : payload;
	const values = (yield* M.st.get()).nondeterminism.solution[meta.val] ?? [];
	return [C.Bubble(meta.val, result, values, C.Capture(yield* evidence(anonymous), body)), result, usages];
}

export function* identity(source: Src.Term): M.Elaboration<{ term: EB.Term; atom: NF.Value; carrier: NF.Value; evidence: boolean }> {
	const ctx = yield* M.reader.ask();
	const [term, type] = yield* EB.infer(source);
	const direct = yield* carrier(type);
	const singleton = direct ? undefined : yield* declaration(type);
	const annotation = direct ?? singleton;
	if (!annotation) {
		const payload = yield* fresh();
		const result = yield* fresh();
		yield* M.constrain({ type: "assign", left: type, right: effect(payload, result), lvl: ctx.env.length });
	}
	const atom = singleton ? type : (yield* NF.view(yield* NF.normalize(term))).value;
	return { term: singleton ? term : yield* NF.quote(ctx.env.length, atom), atom, carrier: annotation ?? type, evidence: !!singleton };
}

export function* carrier(type: NF.Value): M.Elaboration<NF.Value | undefined> {
	const { value } = yield* NF.view(type);
	return yield* match(value)
		.with(Effect, () => M.of(type))
		.with(NF.Patterns.Pi, function* (pi) {
			if (pi.binder.icit !== "Implicit") return undefined;
			const inner = yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Atom("$effectParameter"));
			return (yield* carrier(inner)) ? type : undefined;
		})
		.otherwise(() => M.of(undefined));
}

export function* declaration(atom: NF.Value): M.Elaboration<NF.Value | undefined> {
	const ctx = yield* M.reader.ask();
	const { value } = yield* NF.view(atom);
	return yield* match(value)
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => carrier(ctx.imports[variable.name]?.[1] ?? NF.Type))
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => carrier(ctx.env[ctx.env.length - 1 - variable.lvl]?.type[2] ?? NF.Type))
		.with({ type: "Lit", value: { type: "Atom" } }, function* ({ value }) {
			const declared = Object.values(ctx.imports).find(([tm]) => tm.type === "Lit" && tm.value.type === "Atom" && tm.value.value === value.value);
			return declared ? yield* carrier(declared[1]) : undefined;
		})
		.otherwise(() => M.of(undefined));
}

export function* signature(type: NF.Value, rigid = false): M.Elaboration<[NF.Value, NF.Value]> {
	const ctx = yield* M.reader.ask();
	const { value } = yield* NF.view(type);
	return yield* match(value)
		.with(Effect, ({ func, arg }) => M.of<[NF.Value, NF.Value]>([func.arg, arg]))
		.with(NF.Patterns.Pi, function* (pi): M.Elaboration<[NF.Value, NF.Value]> {
			const argument = rigid
				? NF.Constructors.Atom(`$handlerType${yield* M.supply.fresh("skolem")}`)
				: NF.Constructors.Flex(yield* EB.freshMeta(ctx.env.length, pi.binder.annotation));
			return yield* signature(yield* NF.apply(pi.binder, pi.closure, argument), rigid);
		})
		.otherwise(function* () {
			const payload = yield* fresh();
			const result = yield* fresh();
			yield* M.constrain({ type: "assign", left: type, right: effect(payload, result), lvl: ctx.env.length });
			return [payload, result] as [NF.Value, NF.Value];
		});
}

export function* evidence(atom: NF.Value): M.Elaboration<EB.Term> {
	const ctx = yield* M.reader.ask();
	const key = name(atom);
	const available = ctx.implicits.find(([, type]) => key !== undefined && name(type) === key);
	if (available) return yield* NF.quote(ctx.env.length, available[0]);
	const meta = yield* EB.freshMeta(ctx.env.length, atom);
	yield* M.constrain({ type: "resolve", meta, value: atom, implicits: ctx.implicits });
	return C.Var(meta);
}

export function* lexical(ctx: EB.Context): M.Elaboration<EB.Context> {
	if (ctx.controlHandler) return ctx;
	const implicits = yield* M.traverse(ctx.implicits, function* (candidate) {
		const [value, type] = candidate;
		const installed = name(value) !== undefined && name(value) === name(type);
		return installed && (name(type) === "$anonymous" || (yield* declaration(type))) ? undefined : candidate;
	});
	return { ...ctx, implicits: implicits.filter((entry): entry is EB.Context["implicits"][number] => !!entry) };
}

export function* requirements(constraints: M.Told[], resolutions: EB.Resolutions): M.Elaboration<Array<Extract<M.Told, { type: "resolve" }>>> {
	const registry = yield* Metas.registry.get();
	const found = yield* M.traverse(constraints, function* (constraint) {
		if (constraint.type !== "resolve" || resolutions[constraint.meta.val] || Metas.solution(registry, constraint.meta.val)) return undefined;
		return name(constraint.value) === "$anonymous" || (yield* declaration(constraint.value)) ? constraint : undefined;
	});
	return found.filter((entry): entry is Extract<M.Told, { type: "resolve" }> => !!entry);
}

export function* abstract([term, type, usages]: EB.AST, constraints: M.Told[]): M.Elaboration<EB.AST> {
	const { resolutions } = yield* EB.solve(constraints);
	const needed = yield* requirements(constraints, resolutions);
	if (!needed.length) return [term, type, usages];
	const ctx = yield* M.reader.ask();
	const count = needed.length;
	const lift = (term: EB.Term, count: number) => EB.rewrite(term, (t, depth) => {
		if (t.type !== "Var") return t;
		if (t.variable.type === "Bound" && t.variable.index >= depth) return C.Var(EB.Bound(t.variable.index + count));
		if (t.variable.type === "Meta") {
			const { val } = t.variable;
			const position = needed.findIndex(c => c.meta.val === val);
			if (position >= 0) return C.Var(EB.Bound(depth + count - 1 - position));
		}
		return t;
	});
	const annotations = yield* M.traverse(needed, (c, i) => (function* () {
		return { variable: `e${i}`, annotation: lift(yield* NF.quote(ctx.env.length, c.value), i) };
	})());
	const wrapped = annotations.reduceRight((body, b) => C.Lambda(b.variable, "Implicit", body, b.annotation), lift(term, count));
	const pi = annotations.reduceRight((body, b) => C.Pi(b.variable, "Implicit", b.annotation, body), lift(yield* NF.quote(ctx.env.length, type), count));
	yield* M.st.modify(s => ({ ...s, discharged: new Set([...s.discharged, ...needed.map(c => c.id)]) }));
	return [wrapped, yield* NF.normalize(pi), usages];
}

export function* pure(constraints: M.Told[]): M.Elaboration<void> {
	const { resolutions } = yield* EB.solve(constraints);
	const needed = yield* requirements(constraints, resolutions);
	if (needed.length) throw new Error(`Function requires effect evidence for ${name(needed[0].value) ?? "an identity"}; its expected type is pure`);
}

export function* hasEvidence(type: NF.Value): M.Elaboration<boolean> {
	const { value } = yield* NF.view(type);
	if (value.type !== "Abs" || value.binder.type !== "Pi" || value.binder.icit !== "Implicit") return false;
	if (name(value.binder.annotation) === "$anonymous" || (yield* declaration(value.binder.annotation))) return true;
	return yield* hasEvidence(yield* NF.apply(value.binder, value.closure, NF.Constructors.Atom("$parameter")));
}

/** Each branch starts at the same answer type and agrees on its outgoing answer. */
export function* branches<A, B>(items: A[], action: (item: A, index: number) => M.Elaboration<B>): M.Elaboration<B[]> {
	const { delimitations } = yield* M.st.get();
	const outcomes = yield* M.traverse(items, function* (item, index) {
		yield* M.st.modify(s => ({ ...s, delimitations }));
		const value = yield* action(item, index);
		return { value, delimitations: (yield* M.st.get()).delimitations };
	});
	const merged = [...(outcomes[0]?.delimitations ?? delimitations)];
	const ctx = yield* M.reader.ask();
	for (let i = 0; i < delimitations.length; i++) {
		if (outcomes.some(o => o.delimitations[i]?.next)) {
			const common = merged[i].next ?? merged[i].answer.final;
			for (const outcome of outcomes) {
				const other = outcome.delimitations[i];
				yield* M.constrain({ type: "assign", left: common, right: other.next ?? other.answer.final, lvl: ctx.env.length });
			}
			merged[i] = { ...merged[i], shifted: true, next: common };
		}
	}
	yield* M.st.modify(s => ({ ...s, delimitations: merged }));
	return outcomes.map(o => o.value);
}

/** Ordinary record fields participate in the same candidate list as their record. */
export function* candidates(term: EB.Term, type: NF.Value): M.Elaboration<EB.Context["implicits"]> {
	const value = yield* NF.normalize(term);
	const viewed = (yield* NF.view(type)).value;
	const schema = viewed.type === "Abs" && (viewed.binder.type === "SigmaV2" || viewed.binder.type === "Sigma")
		? yield* NF.apply(viewed.binder, viewed.closure, value) : type;
	const row = yield* NF.rowOf(schema);
	const fields = row ? yield* M.traverse(row.entries, function* ({ label, value: annotation }) {
		return [yield* NF.normalize(C.Proj(label, term)), annotation] as EB.Context["implicits"][number];
	}) : [];
	return [[value, type], ...fields];
}

export const name = (atom: NF.Value): string | undefined => match(atom)
	.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => value.value)
	.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => variable.name)
	.with({ type: "Neutral" }, ({ value }) => name(value))
	.with({ type: "Glued" }, ({ unfolded }) => name(unfolded))
	.otherwise(() => undefined);

export const effect = (payload: NF.Value, result: NF.Value) => NF.Constructors.App(NF.Constructors.App(NF.Constructors.Atom("Effect"), payload, "Explicit"), result, "Explicit");
const fresh = function* (): M.Elaboration<NF.Value> { return NF.Constructors.Flex(yield* EB.freshMeta((yield* M.reader.ask()).env.length, NF.Type)); };
const arrow = function* (from: NF.Value, to: NF.Value): M.Elaboration<NF.Value> { return NF.Constructors.Pi("x", "Explicit", from, yield* NF.closeVal(to)); };

const deep = (handler: EB.Term): EB.Term => {
	const v = (index: number) => C.Var(EB.Bound(index));
	const lam = (variable: string, body: EB.Term) => C.Lambda(variable, "Explicit", body, EB.Any);
	const body = C.App("Explicit", C.App("Explicit", v(2), v(1)), lam("$value", C.Resume(v(1), v(0))));
	return C.App("Explicit", lam("$handler", lam("$payload", lam("$continuation", body))), handler);
};

export const contains = (term: EB.Term): boolean => match(term)
	.with({ type: "Capture" }, { type: "Resume" }, () => true)
	.with({ type: "Reset" }, ({ term, identity }) => !!identity || contains(term))
	.with({ type: "Abs" }, ({ body }) => contains(body))
	.with({ type: "App" }, ({ func, arg }) => contains(func) || contains(arg))
	.with({ type: "Row" }, ({ row }) => row.entries.some(({ value }) => contains(value)))
	.with({ type: "Proj" }, { type: "Ann" }, { type: "Modal" }, ({ term }) => contains(term))
	.with({ type: "Inj" }, ({ value, term }) => contains(value) || contains(term))
	.with({ type: "Match" }, ({ scrutinee, alternatives }) => contains(scrutinee) || alternatives.some(({ term }) => contains(term)))
	.with({ type: "Block" }, ({ statements, return: ret }) => statements.some(s => contains(s.value)) || contains(ret))
	.with({ type: "Bubble" }, ({ shift }) => contains(shift))
	.otherwise(() => false);
