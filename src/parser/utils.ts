import { SyntaxNode } from "./types/generated";
import { YapFieldMap } from "tree-sitter-yap/bindings/node/yap-field-map";

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
