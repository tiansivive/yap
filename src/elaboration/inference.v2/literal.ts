import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";

import * as F from "fp-ts/lib/function";

import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";

import { NF } from "@yap/elaboration";
import { SyntaxType } from "@yap/cst/types/generated";
import * as tmp from "./tmp";

type Literal = Extract<CST.Types.SyntaxNode, { type: "literal" }>;

export const infer = (lit: Literal): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: lit, metadata: { action: "infer", description: "Literal" } },
		M.Do(function* () {
			const node = lit.firstChild;
			if (!node) {
				throw new Error("Literal node has no children");
			}

			const typing: readonly [Lit.Literal, Lit.Literal] = match(node.type)
				.with(SyntaxType.String, _ => [Lit.String(node.text), Lit.Atom("String")] as const)
				.with(SyntaxType.Number, _ => [Lit.Num(Number(node.text)), Lit.Atom("Num")] as const)
				.with(SyntaxType.Boolean, _ => [Lit.Bool(node.text === "true"), Lit.Atom("Bool")] as const)
				.with(SyntaxType.Bang, _ => [Lit.unit(), Lit.Atom("Unit")] as const)
				.with(SyntaxType.Unit, _ => [Lit.Unit(), Lit.Atom("Type")] as const)
				.with(SyntaxType.Row, _ => [Lit.Row(), Lit.Atom("Type")] as const)
				.with(SyntaxType.TypeOfTypes, _ => [Lit.Type(), Lit.Atom("Type")] as const)
				.otherwise(_ => {
					throw new Error(`Unknown literal type: ${node.type}`);
				});

			return [EB.Constructors.Lit(typing[0]), NF.Constructors.Lit(typing[1])] satisfies tmp.Typing;
		}),
	);

infer.gen = F.flow(infer, M.pure);
