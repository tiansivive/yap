import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import assert from "node:assert";
import { set, update } from "@yap/utils";

type Shift = Extract<Src.Term, { type: "shift" }>;

export const infer = (shift: Shift): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			const { delimitations } = yield* V2.getSt();
			if (delimitations.length === 0) {
				throw new Error("shift without enclosing reset");
			}
			const [{ answer }] = delimitations;

			/**
			 * Γ, k: A → α; β ⊢ e : β; β
			 * ---------------------------------- (Shift)
			 * Γ; α ⊢ Sk : A → α.e : A; β
			 */

			const ma = yield* EB.freshMeta(ctx.env.length, NF.Type);
			// const mb = yield* EB.freshMeta(ctx.env.length, NF.Type)
			const A = NF.Constructors.Flex(ma);

			const skolem = yield* EB.freshMeta(ctx.env.length, A);
			const out = EB.Constructors.Var(skolem);

			const kBinder = "$k";
			const kTy = NF.Constructors.Pi(kBinder, "Explicit", A, NF.closeVal(ctx, answer.initial));
			// const expected = NF.Constructors.Pi(
			// 	"$k",
			// 	"Explicit",
			// 	kTy,
			// 	NF.closeVal(ctx, answer.final),
			// )

			yield* V2.modifySt(F.flow(set("delimitations.0.shifted", true), set("delimitations.0.answer.initial", answer.final)));

			const [ktm, us] = yield* V2.local(
				ctx => EB.bind(ctx, { type: "Continuation", variable: kBinder, resumption: { meta: skolem } }, kTy),
				EB.check(shift.term, answer.final),
			);
			yield* V2.modifySt(set("delimitations.0.answer.initial", answer.initial));

			const body = EB.Constructors.Lambda(kBinder, "Explicit", ktm, NF.quote(ctx, ctx.env.length, kTy));
			const tm = EB.Constructors.Shift(body);

			yield* V2.modifySt(set(`skolems.${skolem.val}`, tm));
			return [out, A, us] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);

type Resume = Extract<Src.Term, { type: "resume" }>;
export const resume = (resume: Resume): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: resume, metadata: { action: "infer", description: "Resume" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const idx = ctx.env.findIndex(entry => entry.name.type === "Continuation");
			if (idx === -1) {
				throw new Error("resume without enclosing shift");
			}
			const {
				type: [, , annotation],
				name: binder,
			} = ctx.env[idx];
			assert(binder.type === "Continuation", "Expected continuation binder");
			assert(annotation.type === "Abs" && annotation.binder.type === "Pi", "Expected continuation to have Pi type");

			const [atm, aus] = yield* EB.check.gen(resume.term, annotation.binder.annotation);
			const va = NF.evaluate(ctx, atm);
			const codomain = NF.apply(annotation.binder, annotation.closure, va);
			yield* V2.modifySt(update(`nondeterminism.solution.${binder.resumption.meta.val}`, (vals = []) => [va, ...vals]));

			const k = EB.Constructors.Var({ type: "Bound", index: idx });
			const rtm = EB.Constructors.App("Explicit", k, atm);
			return [rtm, codomain, aus] satisfies EB.AST;
		}),
	);
