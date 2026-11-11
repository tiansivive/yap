import * as O from "fp-ts/lib/Option";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import assert from "node:assert";
import { update } from "@yap/utils";

type Shift = Extract<Src.Term, { type: "shift" }>;

export const infer = (shift: Shift): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } }, function* () {
		const ctx = yield* M.reader.ask();

		const [[identity, effectType], answer] = yield* EB.Control.anonymous();
		const [, A] = yield* EB.Control.signature(effectType);

		/**
		 * Γ, k: A → α; β ⊢ e : β; β
		 * ---------------------------------- (Shift)
		 * Γ; α ⊢ Sk : A → α.e : A; β
		 */

		const skolem = yield* EB.freshMeta(ctx.env.length, A);

		const kBinder = "$k";
		const kTy = NF.Constructors.Pi(kBinder, "Explicit", A, yield* NF.closeVal(answer.initial));

		const [ktm, us] = yield* M.st.local(
			"delimiter",
			O.none,
			M.reader.local(ctx => EB.bind(ctx, { type: "Continuation", variable: kBinder, resumption: { meta: skolem } }, kTy), EB.check(shift.term, answer.final)),
		);

		const body = EB.Constructors.Lambda(kBinder, "Explicit", ktm, yield* NF.quote(ctx.env.length, kTy));
		const tm = EB.Constructors.Suspend(identity, body, yield* NF.quote(ctx.env.length, A));
		const { nondeterminism } = yield* M.st.get();
		const values = nondeterminism.solution[skolem.val] ?? [];
		const out = EB.Constructors.Bubble(skolem.val, A, values, tm);

		return [out, A, us] satisfies EB.AST;
	});

type Resume = Extract<Src.Term, { type: "resume" }>;
export const resume = (resume: Resume): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: resume, metadata: { action: "infer", description: "Resume" } }, function* () {
		const ctx = yield* M.reader.ask();

		const idx = ctx.env.findIndex(entry => entry.name.type === "Continuation");
		if (idx === -1) {
			throw new Error("resume without enclosing shift");
		}
		const {
			type: [, , kty],
			name: binder,
		} = ctx.env[idx];
		assert(binder.type === "Continuation", "Expected continuation binder");
		assert(kty.type === "Abs" && kty.binder.type === "Pi", "Expected continuation to have Pi type");

		const [atm, aus] = yield* EB.check(resume.term, kty.binder.annotation);
		const va = yield* NF.normalize(atm);
		const codomain = yield* NF.apply(kty.binder, kty.closure, va);
		yield* M.st.modify(update(`nondeterminism.solution.${binder.resumption.meta.val}`, (vals = []) => [va, ...vals]));

		const k = EB.Constructors.Var({ type: "Bound", index: idx });
		const rtm = EB.Constructors.App("Explicit", k, atm);
		return [rtm, codomain, aus] satisfies EB.AST;
	});
