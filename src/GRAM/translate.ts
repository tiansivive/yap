import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";
import type { Row } from "@yap/shared/rows";
import { match } from "ts-pattern";

import type { Graph, NodeId, Payload } from "./graph";
import { Nodes, Edges, mkGraph, resetId } from "./graph";
import { Tags, Labels } from "./vocabulary";
import type { Provenance, Location } from "./provenance";
import { TRANSLATE } from "./provenance";

// ── State ──

type State = {
	readonly graph: Graph;
	readonly binders: ReadonlyArray<NodeId>;
	readonly freeVars: ReadonlyMap<string, NodeId>;
	readonly foreignVars: ReadonlyMap<string, NodeId>;
	readonly locations: ReadonlyMap<number, Location>;
	readonly types: Readonly<Record<number, { nf: NF.Value }>>;
	readonly arities: Readonly<Record<string, number>>;
};

const mkState = (opts?: { locations?: ReadonlyMap<number, Location>; types?: Record<number, { nf: NF.Value }>; arities?: Record<string, number> }): State => ({
	graph: mkGraph(),
	binders: [],
	freeVars: new Map(),
	foreignVars: new Map(),
	locations: opts?.locations ?? new Map(),
	types: opts?.types ?? {},
	arities: opts?.arities ?? {},
});

// ── Helpers ──

const prov = (id: number, st: State): Provenance => ({
	location: st.locations.get(id),
	created_by: TRANSLATE,
});

const emit = (st: State, tag: string, payload: Payload, p: Provenance): [NodeId, State] => {
	const [id, graph] = Nodes.add(tag, payload, p)(st.graph);
	return [id, { ...st, graph }];
};

const link = (st: State, source: NodeId, label: string, target: NodeId): State => ({
	...st,
	graph: Edges.add(source, label, target)(st.graph),
});

const push = (st: State, id: NodeId): State => ({
	...st,
	binders: [...st.binders, id],
});

const pop = (st: State): State => ({
	...st,
	binders: st.binders.slice(0, -1),
});

const resolve = (st: State, index: number): NodeId | undefined => st.binders[st.binders.length - 1 - index];

// ── Entry ──

export const translate = (
	term: EB.Term,
	opts?: {
		locations?: ReadonlyMap<number, Location>;
		types?: Record<number, { nf: NF.Value }>;
		arities?: Record<string, number>;
	},
): Graph => {
	resetId();
	const st = mkState(opts);
	const [entryId, final] = walk(term, st);
	return Edges.add(st.graph.root, Labels.ENTRY, entryId)(final.graph);
};

// ── Dispatch ──

const walk = (term: EB.Term, st: State): [NodeId, State] =>
	match(term)
		.with({ type: "Lit" }, t => lit(t, st))
		.with({ type: "Var" }, t => variable(t.variable, t.id, st))
		.with({ type: "Abs", binding: { type: "Lambda" } }, t => abs(Tags.LAMBDA, t, st))
		.with({ type: "Abs", binding: { type: "Pi" } }, t => abs(Tags.PI, t, st))
		.with({ type: "Abs", binding: { type: "Sigma" } }, t => abs(Tags.SIGMA, t, st))
		.with({ type: "Abs", binding: { type: "Mu" } }, t => mu(t, st))
		.with({ type: "Abs", binding: { type: "Let" } }, t => letBinding(t, st))
		.with({ type: "App" }, t => app(t, st))
		.with({ type: "Row" }, t => row(t.row, t.id, st))
		.with({ type: "Proj" }, t => proj(t, st))
		.with({ type: "Inj" }, t => inj(t, st))
		.with({ type: "Match" }, t => matchExpr(t, st))
		.with({ type: "Block" }, t => block(t, st))
		.with({ type: "Modal" }, t => modal(t, st))
		.with({ type: "Reset" }, t => reset(t, st))
		.with({ type: "Shift" }, t => shift(t, st))
		.exhaustive();

// ── Leaves ──

const lit = (t: EB.Term & { type: "Lit" }, st: State): [NodeId, State] => emit(st, Tags.LIT, { value: t.value }, prov(t.id, st));

const variable = (v: EB.Variable, tid: number, st: State): [NodeId, State] =>
	match(v)
		.with({ type: "Bound" }, ({ index }) => {
			const [id, s] = emit(st, Tags.VAR_BOUND, { index }, prov(tid, st));
			const target = resolve(st, index);
			return (target !== undefined ? [id, link(s, id, Labels.REFERS_TO, target)] : [id, s]) as [NodeId, State];
		})
		.with({ type: "Free" }, ({ name }) => intern(Tags.VAR_FREE, name, "freeVars", tid, st))
		.with({ type: "Foreign" }, ({ name }) => intern(Tags.VAR_FOREIGN, name, "foreignVars", tid, st))
		.with({ type: "Label" }, ({ name }) => emit(st, Tags.VAR_LABEL, { name }, prov(tid, st)))
		.with({ type: "Meta" }, ({ val, lvl }) => emit(st, Tags.VAR_META, { val, lvl }, prov(tid, st)))
		.exhaustive();

const intern = (tag: string, name: string, pool: "freeVars" | "foreignVars", tid: number, st: State): [NodeId, State] => {
	let defId = st[pool].get(name);
	let s = st;

	if (defId === undefined) {
		const arity = pool === "foreignVars" ? st.arities[name] : undefined;
		const payload = arity !== undefined ? { name, arity } : { name };
		const [id, s2] = emit(st, tag, payload, prov(tid, st));
		defId = id;
		s = { ...s2, [pool]: new Map([...s2[pool], [name, defId]]) };
	}

	const [ref, s3] = emit(s, Tags.VAR_REF, { name }, prov(tid, s));
	return [ref, link(s3, ref, Labels.REFERS_TO, defId)];
};

// ── Abstractions ──

const bindingPayload = (b: EB.Binding): Payload =>
	match(b)
		.with({ type: "Lambda" }, b => ({ variable: b.variable, icit: b.icit }))
		.with({ type: "Pi" }, b => ({ variable: b.variable, icit: b.icit }))
		.with({ type: "Sigma" }, b => ({ variable: b.variable }))
		.with({ type: "Mu" }, b => ({ variable: b.variable, source: b.source }))
		.with({ type: "Let" }, b => ({ variable: b.variable }))
		.exhaustive();

const abs = (tag: string, t: EB.Term & { type: "Abs" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, tag, bindingPayload(t.binding), prov(t.id, st));
	const [ann, s2] = walk(t.binding.annotation, s1);
	const s3 = link(s2, id, Labels.ANNOTATION, ann);
	const [body, s4] = walk(t.body, push(s3, id));
	return [id, link(pop(s4), id, Labels.BODY, body)];
};

const mu = (t: EB.Term & { type: "Abs"; binding: { type: "Mu" } }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.MU, bindingPayload(t.binding), prov(t.id, st));
	const [ann, s2] = walk(t.binding.annotation, s1);
	const s3 = link(s2, id, Labels.ANNOTATION, ann);
	const [body, s4] = walk(t.body, push(s3, id));
	return [id, link(pop(s4), id, Labels.BODY, body)];
};

const letBinding = (t: EB.Term & { type: "Abs"; binding: { type: "Let" } }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.LET, bindingPayload(t.binding), prov(t.id, st));
	const [val, s2] = walk(t.binding.value, s1);
	const s3 = link(s2, id, Labels.VALUE, val);
	const [ann, s4] = walk(t.binding.annotation, s3);
	const s5 = link(s4, id, Labels.ANNOTATION, ann);
	const [body, s6] = walk(t.body, push(s5, id));
	return [id, link(pop(s6), id, Labels.BODY, body)];
};

// ── Application ──

const app = (t: EB.Term & { type: "App" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.APP, { icit: t.icit }, prov(t.id, st));
	const [fn, s2] = walk(t.func, s1);
	const [arg, s3] = walk(t.arg, link(s2, id, Labels.FUNC, fn));
	return [id, link(s3, id, Labels.ARG, arg)];
};

// ── Rows ──

const row = (r: Row<EB.Term, EB.Variable>, tid: number, st: State): [NodeId, State] =>
	match(r)
		.with({ type: "empty" }, () => emit(st, Tags.ROW_EMPTY, {}, prov(tid, st)))
		.with({ type: "extension" }, r => {
			const [id, s1] = emit(st, Tags.ROW_EXT, { label: r.label }, prov(tid, st));
			const [val, s2] = walk(r.value, s1);
			const [rest, s3] = row(r.row, tid, link(s2, id, Labels.VALUE, val));
			return [id, link(s3, id, Labels.REST, rest)] as [NodeId, State];
		})
		.with({ type: "variable" }, r => variable(r.variable, tid, st))
		.exhaustive();

// ── Structural ──

const proj = (t: EB.Term & { type: "Proj" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.PROJ, { label: t.label }, prov(t.id, st));
	const [tgt, s2] = walk(t.term, s1);
	return [id, link(s2, id, Labels.TARGET, tgt)];
};

const inj = (t: EB.Term & { type: "Inj" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.INJ, { label: t.label }, prov(t.id, st));
	const [val, s2] = walk(t.value, s1);
	const [tgt, s3] = walk(t.term, link(s2, id, Labels.VALUE, val));
	return [id, link(s3, id, Labels.TARGET, tgt)];
};

// ── Match ──

const matchExpr = (t: EB.Term & { type: "Match" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.MATCH, {}, prov(t.id, st));
	const [scrut, s2] = walk(t.scrutinee, s1);

	return t.alternatives.reduce<[NodeId, State]>(
		([mid, s], alt, i) => {
			const [cid, s2] = emit(s, Tags.CASE, { pattern: alt.pattern, binders: alt.binders }, prov(t.id, s));
			const s3 = link(s2, mid, Labels.caseN(i), cid);
			const bound = (alt.binders ?? []).reduce<State>((acc, _) => push(acc, cid), s3);
			const [body, s4] = walk(alt.term, bound);
			const unbound = (alt.binders ?? []).reduce<State>(pop, s4);
			return [mid, link(unbound, cid, Labels.BODY, body)];
		},
		[id, link(s2, id, Labels.SCRUTINEE, scrut)],
	);
};

// ── Block ──

const block = (t: EB.Term & { type: "Block" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.BLOCK, {}, prov(t.id, st));

	const s2 = t.statements.reduce<State>(
		(s, stmt, i) =>
			match(stmt)
				.with({ type: "Expression" }, stmt => {
					const [sid, s2] = emit(s, Tags.STMT_EXPR, {}, prov(t.id, s));
					const [val, s3] = walk(stmt.value, s2);
					return link(link(s3, sid, Labels.VALUE, val), id, Labels.stmtN(i), sid);
				})
				.with({ type: "Let" }, stmt => {
					const [sid, s2] = emit(s, Tags.STMT_LET, { variable: stmt.variable }, prov(t.id, s));
					const [val, s3] = walk(stmt.value, s2);
					const s4 = link(link(s3, sid, Labels.VALUE, val), id, Labels.stmtN(i), sid);
					return push(s4, sid);
				})
				.with({ type: "Using" }, stmt => {
					const [sid, s2] = emit(s, Tags.STMT_USING, {}, prov(t.id, s));
					const [val, s3] = walk(stmt.value, s2);
					return link(link(s3, sid, Labels.VALUE, val), id, Labels.stmtN(i), sid);
				})
				.exhaustive(),
		s1,
	);

	const [ret, s3] = walk(t.return, s2);
	return [id, link(s3, id, Labels.RETURN, ret)];
};

// ── Control ──

const modal = (t: EB.Term & { type: "Modal" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.MODAL, { quantity: t.modalities.quantity }, prov(t.id, st));
	const [body, s2] = walk(t.term, s1);
	return [id, link(s2, id, Labels.TERM, body)];
};

const reset = (t: EB.Term & { type: "Reset" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.RESET, {}, prov(t.id, st));
	const [body, s2] = walk(t.term, s1);
	return [id, link(s2, id, Labels.BODY, body)];
};

const shift = (t: EB.Term & { type: "Shift" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.SHIFT, {}, prov(t.id, st));
	const [body, s2] = walk(t.body, s1);
	return [id, link(s2, id, Labels.BODY, body)];
};
