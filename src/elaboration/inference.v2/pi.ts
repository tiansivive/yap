import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import { Implicitness } from "@yap/shared/implicitness";

type Pi = Extract<CST.Types.SyntaxNode, { type: "pi" | "arrow" }>;

export const infer = (node: Pi): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Pi/Arrow type" } },
		M.Do(function* () {
			const { domain, icit, codomain } = CST.Utils.extractFields(node, "domain", "icit", "codomain");

			const implicitness: Implicitness = icit.type === "implicit" ? "Implicit" : "Explicit";

			const params = domain.childrenForFieldName("param");

			if (params.length === 0) {
				throw new Error("Missing domain in pi/arrow");
			}

			const buildPi = function* (ps: CST.Types.SyntaxNode[]): Generator<M.Elaboration<any>, EB.Term, any> {
				const [param, ...rest] = ps as [CST.Types.SyntaxNode, ...CST.Types.SyntaxNode[]];

				const variable = param.type === "typing" ? CST.Utils.requireField(param, "name").text : `t${EB.nextCount()}`;

				const annNode = param.type === "typing" ? CST.Utils.requireField(param, "type") : param;

				const ty = yield* tmp.check(annNode, NF.Type);
				const ctx = yield* M.ask();
				const va = NF.evaluate(ctx, ty);

				const body = yield* M.local(
					_ctx => EB.bind(_ctx, { type: "Pi", variable }, va),
					M.Do(() => {
						if (rest.length === 0) {
							return tmp.check(codomain, NF.Type);
						}
						return buildPi(rest);
					}),
				);

				return EB.Constructors.Pi(variable, implicitness, ty, body);
			};

			const piTm = yield* buildPi(params);

			return [piTm, NF.Type] satisfies tmp.Typing;
		}),
	);
