import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/elaboration/normalization";

import * as CST from "@yap/cst";
import { update } from "@yap/utils";

import * as tmp from "./tmp";

type ResetNode = Extract<CST.Types.SyntaxNode, { type: "reset" }>;

export const infer = (reset: ResetNode): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node: reset, metadata: { action: "infer", description: "Reset expression" } },
        M.Do<tmp.Typing, EB.Context>(function* () {
            const ctx = yield* M.ask();

            /****************************************************
             * //TODO: ANSWER-TYPE POLYMORPHISM LOGIC
             *
             * - A is the initial answer type
             * 	- The return type of the continuation k
             * 	- Intuitively represents the return type of the expression inside reset if there were no shifts
             * - R is the final result type after handling shifts
             * 	- The return type of the handler
             * 	- Represents the actual return type of the entire reset expression
             *  - Intuitively, R overrides A via the handler
             ****************************************************/

            const metaA = yield* EB.freshMeta(ctx.env.length, NF.Type);
            const metaR = yield* EB.freshMeta(ctx.env.length, NF.Type);

            const d: M.Delimitation = {
                answer: {
                    initial: NF.Constructors.Var(metaA),
                    final: NF.Constructors.Var(metaR),
                },
                shifted: false,
            };

            yield* M.modifySt(update("delimitations", ds => [d, ...ds]));
            const { metas } = yield* M.listen();

            // Extract the term inside reset
            const { body } = CST.Utils.extractFields(reset, "body");

            const tm = yield* M.local(
                update("metas", ms => ({ ...ms, ...metas })),
                M.Do(() => tmp.check(body, d.answer.initial)),
            );

            const {
                delimitations: [{ shifted }],
            } = yield* M.getSt();

            if (!shifted) {
                // No shifts were used, so initial and final answer types must be the same
                yield* M.tell("constraint", { type: "assign", left: d.answer.initial, right: d.answer.final });
            }

            yield* M.modifySt(update("delimitations", ([d, ...ds]) => ds));
            return [EB.Constructors.Reset(tm), d.answer.final] satisfies tmp.Typing;
        }),
    );
