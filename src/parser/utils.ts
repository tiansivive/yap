import * as Q from "@yap/shared/modalities/multiplicity";

import { ParamNode, SyntaxNode, TypingNode } from "./types/generated";
import { YapFieldMap } from "tree-sitter-yap/bindings/node/yap-field-map";

type ModalNode = Extract<SyntaxNode, { type: "modal" }>;

export type ExtractModalResult = {
	term: SyntaxNode;
	quantity: Q.Multiplicity;
	liquid: SyntaxNode | null;
};

/** Extract term, quantity, and optional liquid from a modal CST node.
 *  Modal has no named fields; children vary by grammar variant:
 *  - `<q> expr [| l |]` → quantity, expr, lambda
 *  - `<q> expr` → quantity, expr
 *  - `expr [| l |]` → expr, lambda */
export function extractModal(node: ModalNode): ExtractModalResult {
	const children = node.namedChildren;
	const quantity = children.find(c => c.type === "quantity");
	const lambda = children.find(c => c.type === "lambda");
	const term = children.find(c => c.type !== "quantity" && c.type !== "lambda");

	if (!term) {
		throw new Error("Modal node must have a term child");
	}
	const q: Q.Multiplicity = quantity ? (quantity.text === "0" ? Q.Zero : quantity.text === "1" ? Q.One : Q.Many) : Q.Many;
	return { term, quantity: q, liquid: lambda ?? null };
}

function lookupField(node: SyntaxNode, fieldName: string) {
	return node?.childrenForFieldName(fieldName) ?? [];
}

export function requireField(node: SyntaxNode, fieldName: string): SyntaxNode;
export function requireField(node: SyntaxNode, fieldName: string, repeatable: true): SyntaxNode[];
export function requireField(node: SyntaxNode, fieldName: string, repeatable = false) {
	const children = lookupField(node, fieldName);

	if (!children.length) {
		throw new Error(`Missing required field: ${fieldName}`);
	}
	if (!repeatable && children.length !== 1) {
		throw new Error(`Expected single child for field '${fieldName}', found ${children.length}`);
	}
	return repeatable ? children : children[0];
}

type FieldSpecifier<K> = K | [K];

type FieldResult<Spec, K> = Spec extends [K] ? SyntaxNode[] : SyntaxNode;

type FieldName<Spec, K> = Spec extends [infer U extends K] ? U : Spec extends K ? Spec : never;

export function extractFields<T extends keyof YapFieldMap, K extends YapFieldMap[T][number], const F extends readonly FieldSpecifier<K>[]>(
	node: Extract<SyntaxNode, { type: T }>,
	...fields: F
): { [P in F[number] as FieldName<P, K>]: FieldResult<P, K> } {
	const entries = fields.map(spec => {
		if (!Array.isArray(spec)) {
			const value = requireField(node, spec);
			return [spec, value];
		}

		const name = spec[0];
		const value = requireField(node, name, true);
		return [name, value];
	});

	return Object.fromEntries(entries) as { [P in F[number] as FieldName<P, K>]: FieldResult<P, K> };
}

type ParamData = { name: string; annotation: SyntaxNode | null };
/** Extract the variable name and optional type annotation from a `param` CST node.
 *  - Bare param: `param(identifier)` → `{ name, annotation: null }`
 *  - Annotated param: `param(typing(identifier, type_expr))` → `{ name, annotation }` */
export function extractParam(node: ParamNode): ParamData {
	const child = node.firstNamedChild;

	if (!child) {
		throw new Error("Empty param node");
	}

	if (child.type === "typing") {
		const typing = child as TypingNode;
		const [id, ann] = typing.namedChildren;

		if (!id || !ann) {
			throw new Error("Malformed typing node");
		}
		return { name: id.text, annotation: ann };
	}

	return { name: child.text, annotation: null };
}
