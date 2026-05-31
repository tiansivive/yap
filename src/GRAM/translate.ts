import type * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import type { Row } from "@yap/shared/rows";
import { match } from "ts-pattern";
import type { Subst } from "@yap/elaboration/unification/substitution";

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
	readonly zonker: Subst | undefined;
};

const mkState = (opts?: {
	locations?: ReadonlyMap<number, Location>;
	types?: Record<number, { nf: NF.Value }>;
	arities?: Record<string, number>;
	zonker?: Subst;
	parentBinders?: ReadonlyArray<string>;
}): State => {
	let graph = mkGraph();
	const binders: NodeId[] = [];

	for (const name of opts?.parentBinders ?? []) {
		const [id, g] = Nodes.add(Tags.STMT_LET, { variable: name }, { created_by: TRANSLATE })(graph);
		graph = g;
		binders.push(id);
	}

	return {
		graph,
		binders,
		freeVars: new Map(),
		foreignVars: new Map(),
		locations: opts?.locations ?? new Map(),
		types: opts?.types ?? {},
		arities: opts?.arities ?? {},
		zonker: opts?.zonker,
	};
};

// ── Helpers ──

const prov = (id: number, st: State): Provenance => ({
	location: st.locations.get(id),
	created_by: TRANSLATE,
});

const emit = (st: State, tag: string, payload: Payload, p: Provenance): [NodeId, State] => {
	const [id, graph] = Nodes.add(tag, payload, p)(st.graph);
	return [id, { ...st, graph }];
};

const link = (st: State, source: NodeId, label: string, target: NodeId, payload: Payload = {}): State => ({
	...st,
	graph: Edges.add(source, label, target, payload)(st.graph),
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
		zonker?: Subst;
		parentBinders?: ReadonlyArray<string>;
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
		.with({ type: "Bubble" }, t => walk(t.shift, st))
		.with({ type: "Ann" }, t => walk(t.term, st))
		.exhaustive();

// ── Leaves ──

const lit = (t: EB.Term & { type: "Lit" }, st: State): [NodeId, State] => emit(st, Tags.LIT, { value: t.value }, prov(t.id, st));

const variable = (v: EB.Variable, tid: number, st: State): [NodeId, State] =>
	match(v)
		.with({ type: "Bound" }, ({ index }) => {
			const [id, s] = emit(st, Tags.VAR_BOUND, { index }, prov(tid, st));
			const target = resolve(st, index);
			const withRef = target !== undefined ? link(s, id, Labels.REFERS_TO, target) : s;
			const withScopes = st.binders.reduce((acc, binderId, i) => link(acc, id, Labels.SCOPE, binderId, { level: i }), withRef);
			return [id, withScopes] satisfies [NodeId, State];
		})
		.with({ type: "Free" }, ({ name }) => intern(Tags.VAR_FREE, name, "freeVars", tid, st))
		.with({ type: "Foreign" }, ({ name }) => intern(Tags.VAR_FOREIGN, name, "foreignVars", tid, st))
		.with({ type: "Label" }, ({ name }) => emit(st, Tags.VAR_LABEL, { name }, prov(tid, st)))
		.with({ type: "Meta" }, ({ val, lvl }) => {
			const zonked = st.zonker?.[val];

			if (zonked) {
				return walk(NF.quote({ env: [], metas: {}, zonker: st.zonker } as unknown as EB.Context, lvl, zonked), st);
			}
			return emit(st, Tags.VAR_META, { val, lvl }, prov(tid, st));
		})
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
	const withRef = link(s3, ref, Labels.REFERS_TO, defId);
	const withScopes = s.binders.reduce((acc, binderId, i) => link(acc, ref, Labels.SCOPE, binderId, { level: i }), withRef);
	return [ref, withScopes];
};

// ── Abstractions ──

const bindingPayload = (b: EB.Binding, level: number): Payload =>
	match(b)
		.with({ type: "Lambda" }, b => ({ variable: b.variable, icit: b.icit, level }))
		.with({ type: "Pi" }, b => ({ variable: b.variable, icit: b.icit, level }))
		.with({ type: "Sigma" }, b => ({ variable: b.variable, level }))
		.with({ type: "Mu" }, b => ({ variable: b.variable, source: b.source, level }))
		.with({ type: "Let" }, b => ({ variable: b.variable, level }))
		.exhaustive();

const abs = (tag: string, t: EB.Term & { type: "Abs" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, tag, bindingPayload(t.binding, st.binders.length), prov(t.id, st));
	const [ann, s2] = walk(t.binding.annotation, s1);
	const s3 = link(s2, id, Labels.ANNOTATION, ann);
	const [body, s4] = walk(t.body, push(s3, id));
	return [id, link(pop(s4), id, Labels.BODY, body)];
};

const mu = (t: EB.Term & { type: "Abs"; binding: { type: "Mu" } }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.MU, bindingPayload(t.binding, st.binders.length), prov(t.id, st));
	const [ann, s2] = walk(t.binding.annotation, s1);
	const s3 = link(s2, id, Labels.ANNOTATION, ann);
	const [body, s4] = walk(t.body, push(s3, id));
	return [id, link(pop(s4), id, Labels.BODY, body)];
};

const letBinding = (t: EB.Term & { type: "Abs"; binding: { type: "Let" } }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.LET, bindingPayload(t.binding, st.binders.length), prov(t.id, st));
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

const walkPattern = (pat: EB.Pattern, tid: number, st: State): [NodeId, State] =>
	match(pat)
		.with({ type: "Variant" }, p => {
			const ext = p.row as Row<EB.Pattern, string> & { type: "extension" };
			const [id, s1] = emit(st, Tags.PAT_VARIANT, { label: ext.label }, prov(tid, st));
			const [payload, s2] = walkPattern(ext.value, tid, s1);
			const [, s3] = walkPatternRow(ext.row, id, tid, link(s2, id, Labels.PAYLOAD, payload));
			return [id, s3] as [NodeId, State];
		})
		.with({ type: "Struct" }, p => {
			const [id, s1] = emit(st, Tags.PAT_STRUCT, {}, prov(tid, st));
			return walkPatternRow(p.row, id, tid, s1);
		})
		.with({ type: "Row" }, p => {
			const [id, s1] = emit(st, Tags.PAT_STRUCT, {}, prov(tid, st));
			return walkPatternRow(p.row, id, tid, s1);
		})
		.with({ type: "Lit" }, p => emit(st, Tags.PAT_LIT, { value: p.value }, prov(tid, st)))
		.with({ type: "Binder" }, p => {
			const [id, s1] = emit(st, Tags.PAT_BINDER, { name: p.value, level: st.binders.length }, prov(tid, st));
			return [id, push(s1, id)] as [NodeId, State];
		})
		.with({ type: "Var" }, p => {
			const [id, s1] = emit(st, Tags.PAT_BINDER, { name: p.value, level: st.binders.length }, prov(tid, st));
			return [id, push(s1, id)] as [NodeId, State];
		})
		.with({ type: "Wildcard" }, () => emit(st, Tags.PAT_WILDCARD, {}, prov(tid, st)))
		.with({ type: "List" }, p => {
			const [id, s1] = emit(st, Tags.PAT_STRUCT, {}, prov(tid, st));
			return p.patterns.reduce<[NodeId, State]>(
				([parent, s], el, i) => {
					const [child, s2] = walkPattern(el, tid, s);
					return [parent, link(s2, parent, Labels.FIELD, child, { label: String(i) })];
				},
				[id, s1],
			);
		})
		.exhaustive();

const walkPatternRow = (r: Row<EB.Pattern, string>, parentId: NodeId, tid: number, st: State): [NodeId, State] =>
	match(r)
		.with({ type: "extension" }, r => {
			const [child, s1] = walkPattern(r.value, tid, st);
			const s2 = link(s1, parentId, Labels.FIELD, child, { label: r.label });
			return walkPatternRow(r.row, parentId, tid, s2);
		})
		.with({ type: "empty" }, () => [parentId, st] as [NodeId, State])
		.with({ type: "variable" }, () => {
			const [id, s1] = emit(st, Tags.PAT_WILDCARD, {}, prov(tid, st));
			return [parentId, push(s1, id)] as [NodeId, State];
		})
		.exhaustive();

const matchExpr = (t: EB.Term & { type: "Match" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.MATCH, {}, prov(t.id, st));
	const [scrut, s2] = walk(t.scrutinee, s1);
	let prev: NodeId | undefined;

	return t.alternatives.reduce<[NodeId, State]>(
		([mid, s], alt, i) => {
			const [cid, s2] = emit(s, Tags.CASE, {}, prov(t.id, s));
			let s3 = link(s2, mid, Labels.ALT, cid, { index: i });

			if (prev !== undefined) {
				s3 = link(s3, prev, Labels.NEXT, cid);
			}
			prev = cid;
			const depth = s3.binders.length;
			const [patId, s4] = walkPattern(alt.pattern, t.id, s3);
			const s5 = link(s4, cid, Labels.PATTERN, patId);
			const [body, s6] = walk(alt.term, s5);
			const pushed = s6.binders.length - depth;
			const unbound = Array.from({ length: pushed }).reduce<State>(s => pop(s), s6);
			return [mid, link(unbound, cid, Labels.BODY, body)];
		},
		[id, link(s2, id, Labels.SCRUTINEE, scrut)],
	);
};

// ── Block ──

const block = (t: EB.Term & { type: "Block" }, st: State): [NodeId, State] => {
	const [id, s1] = emit(st, Tags.BLOCK, {}, prov(t.id, st));
	let prev: NodeId | undefined;

	const s2 = t.statements.reduce<State>((s, stmt, i) => {
		const linkStmt = (sid: NodeId, s: State): State => {
			let s2 = link(s, id, Labels.STMT, sid, { index: i });

			if (prev !== undefined) {
				s2 = link(s2, prev, Labels.NEXT, sid);
			}
			prev = sid;
			return s2;
		};

		return match(stmt)
			.with({ type: "Expression" }, stmt => {
				const [sid, s2] = emit(s, Tags.STMT_EXPR, {}, prov(t.id, s));
				const [val, s3] = walk(stmt.value, s2);
				return linkStmt(sid, link(s3, sid, Labels.VALUE, val));
			})
			.with({ type: "Let" }, stmt => {
				const [sid, s2] = emit(s, Tags.STMT_LET, { variable: stmt.variable }, prov(t.id, s));
				const [val, s3] = walk(stmt.value, push(s2, sid));
				return linkStmt(sid, link(s3, sid, Labels.VALUE, val));
			})
			.with({ type: "Using" }, stmt => {
				const [sid, s2] = emit(s, Tags.STMT_USING, {}, prov(t.id, s));
				const [val, s3] = walk(stmt.value, s2);
				return linkStmt(sid, link(s3, sid, Labels.VALUE, val));
			})
			.exhaustive();
	}, s1);

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
