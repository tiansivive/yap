import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import { Implicitness } from "@yap/shared/implicitness";
import { update } from "@yap/utils";

type Lambda = Extract<CST.Types.SyntaxNode, { type: "lambda" }>;

export const infer = (node: Lambda): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Lambda node" } },
		M.Do(function* () {
			const { params: paramsNode, body } = CST.Utils.extractFields(node, "params", "body");

			const params = paramsNode.childrenForFieldName("param");

			if (params.length === 0) {
				throw new Error("Missing parameters in lambda");
			}

			const varname = (param: CST.Types.SyntaxNode) => (param.type === "typing" ? CST.Utils.requireField(param, "name").text : param.text);

			const buildLambda = function* (ps: CST.Types.SyntaxNode[]): Generator<M.Elaboration<any>, tmp.Typing, any> {
				const ctx = yield* M.ask();
				const [param, ...rest] = ps;

				const ann =
					param.type === "typing"
						? yield* tmp.check(CST.Utils.requireField(param, "type"), NF.Type)
						: EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));

				const ty = NF.evaluate(ctx, ann);
				const { metas } = yield* M.listen();

				const variable = varname(param);
				const icit: Implicitness = Boolean(param.childForFieldName("explicit")) ? "Explicit" : "Implicit";

				const ast = yield* M.local(
					_ctx => {
						const xtended = EB.bind(_ctx, { type: "Lambda", variable }, ty);
						return update(xtended, "metas", ms => ({ ...ms, ...metas }));
					},
					M.Do(function* () {
						if (rest.length > 0) {
							const partial = yield* buildLambda(rest);
							const tm = EB.Constructors.Lambda(variable, icit, partial[0], ann);
							const pi = NF.Constructors.Pi(variable, icit, ty, NF.closeVal(ctx, partial[1]));
							return [tm, pi] satisfies tmp.Typing;
						}

						// For the body, infer and create Pi type
						const inferred = yield* tmp.infer(body);
						const [bTerm, bType] = yield* EB.Icit.insert.gen(inferred);

						const tm = EB.Constructors.Lambda(variable, icit, bTerm, ann);
						const pi = NF.Constructors.Pi(variable, icit, ty, NF.closeVal(ctx, bType));

						return [tm, pi] satisfies tmp.Typing;
					}),
				);

				return ast;
			};

			return yield* buildLambda(params);
		}),
	);
