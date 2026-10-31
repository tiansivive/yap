import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";

const C = EB.Constructors;
const unsupported = (detail: string): never => {
	throw new Error(`Effects spike lowering: ${detail}. Evaluate this program with the CEK interpreter.`);
};

const lift = (term: EB.Term, amount: number): EB.Term =>
	EB.rewrite(term, (t, depth) =>
		t.type === "Var" && t.variable.type === "Bound" && t.variable.index >= depth ? C.Var(EB.Bound(t.variable.index + amount)) : t,
	);

const substitute = (body: EB.Term, value: EB.Term): EB.Term =>
	EB.rewrite(body, (t, depth) => {
		if (t.type !== "Var" || t.variable.type !== "Bound") {
			return t;
		}

		if (t.variable.index === depth) {
			return lift(value, depth);
		}
		return t.variable.index > depth ? C.Var(EB.Bound(t.variable.index - 1)) : t;
	});

const isValue = (term: EB.Term): boolean => term.type === "Lit" || term.type === "Var" || (term.type === "Abs" && term.binding.type === "Lambda");

/** Specialize the generated deep-handler wrapper and its value arguments. */
const beta = (term: EB.Term, fuel = 64): EB.Term => {
	if (!fuel) {
		return unsupported("handler specialization reached its reduction limit");
	}
	return EB.rewrite(term, t => {
		if (t.type === "Ann") {
			return t.term;
		}
		if (t.type === "App" && t.func.type === "Abs" && t.func.binding.type === "Lambda" && isValue(t.arg)) {
			return beta(substitute(t.func.body, t.arg), fuel - 1);
		}
		return t;
	});
};

const identity = (term?: EB.Term): string | undefined =>
	match(term)
		.with(undefined, () => "$anonymous")
		.with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => value.value)
		.with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => variable.name)
		.otherwise(() => undefined);

/** A single local capture uses the existing direct-style block-and-jump bridge. */
export const localEffects = (term: EB.Term): EB.Term =>
	EB.rewrite(term, t => {
		if (t.type !== "Reset") {
			return t;
		}
		const captures: Extract<EB.Term, { type: "Capture" }>[] = [];
		EB.rewrite(t.term, node => {
			if (node.type === "Capture") {
				captures.push(node);
			}
			return node;
		});
		if (!captures.length) {
			if (t.identity) {
				return unsupported("a named handler requires one visible capture");
			}
			return t;
		}

		if (captures.length !== 1) {
			return unsupported("multiple captures require continuation reification");
		}
		const capture = captures[0];
		const key = identity(t.identity);

		if (!key || identity(capture.identity) !== key) {
			return unsupported("dynamic identities require continuation reification");
		}
		const payload = beta(capture.payload);

		if (!isValue(payload)) {
			return unsupported("the local capture payload must be a value");
		}
		const k = C.Var(EB.Bound(0));
		const applied = t.handler ? C.App("Explicit", C.App("Explicit", lift(beta(t.handler), 1), lift(payload, 1)), k) : C.App("Explicit", lift(payload, 1), k);
		let references = 0;
		let calls = 0;
		const handler = EB.rewrite(beta(applied), (node, depth) => {
			if (node.type === "Capture" || node.type === "Reset") {
				return unsupported("captures in handlers require continuation reification");
			}
			if (node.type === "Var" && node.variable.type === "Bound" && node.variable.index === depth) {
				if (depth) {
					return unsupported("escaping resumptions require continuation reification");
				}
				references++;
			}
			const call = node.type === "Resume" ? C.App("Explicit", node.continuation, node.value) : node;

			if (call.type === "App" && call.func.type === "Var" && call.func.variable.type === "Bound" && call.func.variable.index === depth) {
				calls++;
			}
			return call;
		});

		if (references !== calls) {
			return unsupported("first-class resumptions require continuation reification");
		}
		const shift = C.Shift(C.Lambda("$k", "Explicit", handler, EB.Any));
		const replace = (body: EB.Term): EB.Term =>
			match(body)
				.with({ type: "Capture" }, () => shift)
				.with({ type: "Bubble" }, b => replace(b.shift))
				.with({ type: "Ann" }, b => replace(b.term))
				.with({ type: "App" }, b => ({ ...b, func: replace(b.func), arg: replace(b.arg) }))
				.with({ type: "Lit" }, { type: "Var" }, b => b)
				.otherwise(() => unsupported("the local capture must be in a direct expression"));
		return C.Reset(replace(t.term));
	});
