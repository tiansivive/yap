import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import assert from "node:assert";
import { update } from "@yap/utils";

type Shift = Extract<Src.Term, { type: "shift" }>;

/* Delimited control goes through `capture`; the surface `shift` still parses but no longer elaborates. */
export const infer = (shift: Shift): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } }, function* () {
		throw new Error("shift is not supported: use capture inside a reset");
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
