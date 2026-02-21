import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/elaboration/normalization";

import * as CST from "@yap/cst";
import * as F from "fp-ts/lib/function";
import { set, update } from "@yap/utils";
import assert from "node:assert";

import * as tmp from "./tmp";

type ShiftNode = Extract<CST.Types.SyntaxNode, { type: "shift" }>;

export const infer = (node: ShiftNode): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Shift node" } },
        M.Do<tmp.Typing, EB.Context>(function* () {
            const ctx = yield* M.ask();

            const { delimitations } = yield* M.getSt();
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
            const A = NF.Constructors.Flex(ma);

            const skolem = yield* EB.freshMeta(ctx.env.length, A);
            const out = EB.Constructors.Var(skolem);

            const kBinder = "$k";
            const kTy = NF.Constructors.Pi(kBinder, "Explicit", A, NF.closeVal(ctx, answer.initial));

            yield* M.modifySt(
                F.flow(set("delimitations.0.shifted", true), set("delimitations.0.answer.initial", answer.final)),
            );

            // Extract the term inside shift
            const { body: expr } = CST.Utils.extractFields(node, "body");

            const ktm = yield* M.local(
                ctx => EB.bind(ctx, { type: "Continuation", variable: kBinder, resumption: { meta: skolem } }, kTy),
                M.Do(() => tmp.check(expr, answer.final)),
            );
            yield* M.modifySt(set("delimitations.0.answer.initial", answer.initial));

            const body = EB.Constructors.Lambda(kBinder, "Explicit", ktm, NF.quote(ctx, ctx.env.length, kTy));
            const tm = EB.Constructors.Shift(body);

            yield* M.modifySt(set(`skolems.${skolem.val}`, tm));
            return [out, A] satisfies tmp.Typing;
        }),
    );

type ResumeNode = Extract<CST.Types.SyntaxNode, { type: "resume" }>;

export const resume = (node: ResumeNode): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Resume node" } },
        M.Do(function* () {
            const ctx = yield* M.ask();

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

            // Extract the term inside resume
            const { body } = CST.Utils.extractFields(node, "body");

            const atm = yield* tmp.check(body, kty.binder.annotation);
            const va = NF.evaluate(ctx, atm);
            const codomain = NF.apply(kty.binder, kty.closure, va);
            yield* M.modifySt(
                update(`nondeterminism.solution.${binder.resumption.meta.val}`, (vals = []) => [va, ...vals]),
            );

            const k = EB.Constructors.Var({ type: "Bound", index: idx });
            const rtm = EB.Constructors.App("Explicit", k, atm);
            return [rtm, codomain] satisfies tmp.Typing;
        }),
    );
