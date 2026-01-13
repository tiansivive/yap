export class Parser {
	parse(input: string | Input, oldTree?: Tree, options?: Options): Tree;
	getIncludedRanges(): Range[];
	getTimeoutMicros(): number;
	setTimeoutMicros(timeout: number): void;
	reset(): void;
	getLanguage(): any;
	setLanguage(language?: any): void;
	getLogger(): Logger;
	setLogger(logFunc?: Logger | false | null): void;
	printDotGraphs(enabled?: boolean, fd?: number): void;
}

export type Options = {
	bufferSize?: number;
	includedRanges?: Range[];
};

export type Point = {
	row: number;
	column: number;
};

export type Range = {
	startIndex: number;
	endIndex: number;
	startPosition: Point;
	endPosition: Point;
};

export type Edit = {
	startIndex: number;
	oldEndIndex: number;
	newEndIndex: number;
	startPosition: Point;
	oldEndPosition: Point;
	newEndPosition: Point;
};

export type Logger = (message: string, params: { [param: string]: string }, type: "parse" | "lex") => void;

export interface Input {
	(index: number, position?: Point): string | null;
}

interface SyntaxNodeBase {
	tree: Tree;
	id: number;
	typeId: number;
	grammarId: number;
	type: string;
	grammarType: string;
	isNamed: boolean;
	isMissing: boolean;
	isExtra: boolean;
	hasChanges: boolean;
	hasError: boolean;
	isError: boolean;
	text: string;
	parseState: number;
	nextParseState: number;
	startPosition: Point;
	endPosition: Point;
	startIndex: number;
	endIndex: number;
	parent: SyntaxNode | null;
	children: Array<SyntaxNode>;
	namedChildren: Array<SyntaxNode>;
	childCount: number;
	namedChildCount: number;
	firstChild: SyntaxNode | null;
	firstNamedChild: SyntaxNode | null;
	lastChild: SyntaxNode | null;
	lastNamedChild: SyntaxNode | null;
	nextSibling: SyntaxNode | null;
	nextNamedSibling: SyntaxNode | null;
	previousSibling: SyntaxNode | null;
	previousNamedSibling: SyntaxNode | null;
	descendantCount: number;

	toString(): string;
	child(index: number): SyntaxNode | null;
	namedChild(index: number): SyntaxNode | null;
	childForFieldName(fieldName: string): SyntaxNode | null;
	childForFieldId(fieldId: number): SyntaxNode | null;
	fieldNameForChild(childIndex: number): string | null;
	childrenForFieldName(fieldName: string): Array<SyntaxNode>;
	childrenForFieldId(fieldId: number): Array<SyntaxNode>;
	firstChildForIndex(index: number): SyntaxNode | null;
	firstNamedChildForIndex(index: number): SyntaxNode | null;

	descendantForIndex(index: number): SyntaxNode;
	descendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
	namedDescendantForIndex(index: number): SyntaxNode;
	namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
	descendantForPosition(position: Point): SyntaxNode;
	descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
	namedDescendantForPosition(position: Point): SyntaxNode;
	namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
	descendantsOfType<T extends TypeString>(types: T | readonly T[], startPosition?: Point, endPosition?: Point): NodeOfType<T>[];

	closest<T extends SyntaxType>(types: T | readonly T[]): NamedNode<T> | null;
	walk(): TreeCursor;
}

export interface TreeCursor {
	nodeType: string;
	nodeTypeId: number;
	nodeStateId: number;
	nodeText: string;
	nodeIsNamed: boolean;
	nodeIsMissing: boolean;
	startPosition: Point;
	endPosition: Point;
	startIndex: number;
	endIndex: number;
	readonly currentNode: SyntaxNode;
	readonly currentFieldName: string;
	readonly currentFieldId: number;
	readonly currentDepth: number;
	readonly currentDescendantIndex: number;

	reset(node: SyntaxNode): void;
	resetTo(cursor: TreeCursor): void;
	gotoParent(): boolean;
	gotoFirstChild(): boolean;
	gotoLastChild(): boolean;
	gotoFirstChildForIndex(goalIndex: number): boolean;
	gotoFirstChildForPosition(goalPosition: Point): boolean;
	gotoNextSibling(): boolean;
	gotoPreviousSibling(): boolean;
	gotoDescendant(goalDescendantIndex: number): void;
}

export interface Tree {
	readonly rootNode: SyntaxNode;

	rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): SyntaxNode;
	edit(edit: Edit): Tree;
	walk(): TreeCursor;
	getChangedRanges(other: Tree): Range[];
	getIncludedRanges(): Range[];
	getEditedRange(other: Tree): Range;
	printDotGraph(fd?: number): void;
}

export interface QueryCapture {
	name: string;
	text?: string;
	node: SyntaxNode;
	setProperties?: { [prop: string]: string | null };
	assertedProperties?: { [prop: string]: string | null };
	refutedProperties?: { [prop: string]: string | null };
}

export interface QueryMatch {
	pattern: number;
	captures: QueryCapture[];
}

export type QueryOptions = {
	startPosition?: Point;
	endPosition?: Point;
	startIndex?: number;
	endIndex?: number;
	matchLimit?: number;
	maxStartDepth?: number;
};

export interface PredicateResult {
	operator: string;
	operands: { name: string; type: string }[];
}

export class Query {
	readonly predicates: { [name: string]: Function }[];
	readonly setProperties: any[];
	readonly assertedProperties: any[];
	readonly refutedProperties: any[];
	readonly matchLimit: number;

	constructor(language: any, source: string | Buffer);

	captures(node: SyntaxNode, options?: QueryOptions): QueryCapture[];
	matches(node: SyntaxNode, options?: QueryOptions): QueryMatch[];
	disableCapture(captureName: string): void;
	disablePattern(patternIndex: number): void;
	isPatternGuaranteedAtStep(byteOffset: number): boolean;
	isPatternRooted(patternIndex: number): boolean;
	isPatternNonLocal(patternIndex: number): boolean;
	startIndexForPattern(patternIndex: number): number;
	didExceedMatchLimit(): boolean;
}

export class LookaheadIterable {
	readonly currentTypeId: number;
	readonly currentType: string;

	reset(language: any, stateId: number): boolean;
	resetState(stateId: number): boolean;
	[Symbol.iterator](): Iterator<string>;
}

interface NamedNodeBase extends SyntaxNodeBase {
	isNamed: true;
}

/** An unnamed node with the given type string. */
export interface UnnamedNode<T extends string = string> extends SyntaxNodeBase {
	type: T;
	isNamed: false;
}

type PickNamedType<Node, T extends string> = Node extends { type: T; isNamed: true } ? Node : never;

type PickType<Node, T extends string> = Node extends { type: T } ? Node : never;

/** A named node with the given `type` string. */
export type NamedNode<T extends SyntaxType = SyntaxType> = PickNamedType<SyntaxNode, T>;

/**
 * A node with the given `type` string.
 *
 * Note that this matches both named and unnamed nodes. Use `NamedNode<T>` to pick only named nodes.
 */
export type NodeOfType<T extends string> = PickType<SyntaxNode, T>;

interface TreeCursorOfType<S extends string, T extends SyntaxNodeBase> {
	nodeType: S;
	currentNode: T;
}

type TreeCursorRecord = { [K in TypeString]: TreeCursorOfType<K, NodeOfType<K>> };

/**
 * A tree cursor whose `nodeType` correlates with `currentNode`.
 *
 * The typing becomes invalid once the underlying cursor is mutated.
 *
 * The intention is to cast a `TreeCursor` to `TypedTreeCursor` before
 * switching on `nodeType`.
 *
 * For example:
 * ```ts
 * let cursor = root.walk();
 * while (cursor.gotoNextSibling()) {
 *   const c = cursor as TypedTreeCursor;
 *   switch (c.nodeType) {
 *     case SyntaxType.Foo: {
 *       let node = c.currentNode; // Typed as FooNode.
 *       break;
 *     }
 *   }
 * }
 * ```
 */
export type TypedTreeCursor = TreeCursorRecord[keyof TreeCursorRecord];

export interface ErrorNode extends NamedNodeBase {
	type: SyntaxType.ERROR;
	hasError: true;
}

export const enum SyntaxType {
	ERROR = "ERROR",
	Alternative = "alternative",
	Annotation = "annotation",
	Application = "application",
	Arrow = "arrow",
	Assignment = "assignment",
	Block = "block",
	Boolean = "boolean",
	Dict = "dict",
	Exports = "exports",
	Foreign = "foreign",
	Import = "import",
	Injection = "injection",
	Key = "key",
	KeyValue = "key_value",
	Lambda = "lambda",
	Letdec = "letdec",
	List = "list",
	Literal = "literal",
	Match = "match",
	Modal = "modal",
	Module = "module",
	Mu = "mu",
	Number = "number",
	Operation = "operation",
	Param = "param",
	Params = "params",
	Parenthesized = "parenthesized",
	PatternKeyValue = "pattern_key_value",
	PatternList = "pattern_list",
	PatternRow = "pattern_row",
	PatternStruct = "pattern_struct",
	PatternTagged = "pattern_tagged",
	PatternTuple = "pattern_tuple",
	Pi = "pi",
	Projection = "projection",
	Quantity = "quantity",
	Reset = "reset",
	Resume = "resume",
	ReturnStatement = "return_statement",
	Row = "row",
	Script = "script",
	Shift = "shift",
	SourceFile = "source_file",
	Struct = "struct",
	Tagged = "tagged",
	Tuple = "tuple",
	Typing = "typing",
	Unary = "unary",
	Using = "using",
	Variable = "variable",
	Variant = "variant",
	Comment = "comment",
	ExplicitArrow = "explicit_arrow",
	Field = "field",
	Hole = "hole",
	Identifier = "identifier",
	ImplicitApplication = "implicit_application",
	ImplicitArrow = "implicit_arrow",
	Index = "index",
	Label = "label",
	String = "string",
	Wildcard = "wildcard",
}

export type UnnamedType =
	| "!"
	| "!="
	| "#"
	| "%"
	| "&&"
	| "("
	| ")"
	| "*"
	| "+"
	| "++"
	| ","
	| "-"
	| "->"
	| "."
	| "/"
	| "0"
	| "1"
	| ":"
	| ";"
	| "<"
	| "<="
	| "<>"
	| "<|"
	| "="
	| "=="
	| ">"
	| ">="
	| "Row"
	| "Type"
	| "Unit"
	| "["
	| "[|"
	| "\\"
	| "]"
	| "as"
	| "export"
	| "false"
	| SyntaxType.Foreign // both named and unnamed
	| SyntaxType.Import // both named and unnamed
	| "let"
	| SyntaxType.Match // both named and unnamed
	| SyntaxType.Reset // both named and unnamed
	| SyntaxType.Resume // both named and unnamed
	| "return"
	| SyntaxType.Shift // both named and unnamed
	| "true"
	| SyntaxType.Using // both named and unnamed
	| "{"
	| "|"
	| "|>"
	| "|]"
	| "||"
	| "}"
	| "μ";

export type TypeString = SyntaxType | UnnamedType;

export type SyntaxNode =
	| AtomNode
	| ExprNode
	| PatternNode
	| StatementNode
	| TypeExprNode
	| AlternativeNode
	| AnnotationNode
	| ApplicationNode
	| ArrowNode
	| AssignmentNode
	| BlockNode
	| BooleanNode
	| DictNode
	| ExportsNode
	| ForeignNode
	| ImportNode
	| InjectionNode
	| KeyNode
	| KeyValueNode
	| LambdaNode
	| LetdecNode
	| ListNode
	| LiteralNode
	| MatchNode
	| ModalNode
	| ModuleNode
	| MuNode
	| NumberNode
	| OperationNode
	| ParamNode
	| ParamsNode
	| ParenthesizedNode
	| PatternKeyValueNode
	| PatternListNode
	| PatternRowNode
	| PatternStructNode
	| PatternTaggedNode
	| PatternTupleNode
	| PiNode
	| ProjectionNode
	| QuantityNode
	| ResetNode
	| ResumeNode
	| ReturnStatementNode
	| RowNode
	| ScriptNode
	| ShiftNode
	| SourceFileNode
	| StructNode
	| TaggedNode
	| TupleNode
	| TypingNode
	| UnaryNode
	| UsingNode
	| VariableNode
	| VariantNode
	| UnnamedNode<"!">
	| UnnamedNode<"!=">
	| UnnamedNode<"#">
	| UnnamedNode<"%">
	| UnnamedNode<"&&">
	| UnnamedNode<"(">
	| UnnamedNode<")">
	| UnnamedNode<"*">
	| UnnamedNode<"+">
	| UnnamedNode<"++">
	| UnnamedNode<",">
	| UnnamedNode<"-">
	| UnnamedNode<"->">
	| UnnamedNode<".">
	| UnnamedNode<"/">
	| UnnamedNode<"0">
	| UnnamedNode<"1">
	| UnnamedNode<":">
	| UnnamedNode<";">
	| UnnamedNode<"<">
	| UnnamedNode<"<=">
	| UnnamedNode<"<>">
	| UnnamedNode<"<|">
	| UnnamedNode<"=">
	| UnnamedNode<"==">
	| UnnamedNode<">">
	| UnnamedNode<">=">
	| UnnamedNode<"Row">
	| UnnamedNode<"Type">
	| UnnamedNode<"Unit">
	| UnnamedNode<"[">
	| UnnamedNode<"[|">
	| UnnamedNode<"\\">
	| UnnamedNode<"]">
	| UnnamedNode<"as">
	| CommentNode
	| ExplicitArrowNode
	| UnnamedNode<"export">
	| UnnamedNode<"false">
	| FieldNode
	| UnnamedNode<SyntaxType.Foreign>
	| HoleNode
	| IdentifierNode
	| ImplicitApplicationNode
	| ImplicitArrowNode
	| UnnamedNode<SyntaxType.Import>
	| IndexNode
	| LabelNode
	| UnnamedNode<"let">
	| UnnamedNode<SyntaxType.Match>
	| UnnamedNode<SyntaxType.Reset>
	| UnnamedNode<SyntaxType.Resume>
	| UnnamedNode<"return">
	| UnnamedNode<SyntaxType.Shift>
	| StringNode
	| UnnamedNode<"true">
	| UnnamedNode<SyntaxType.Using>
	| WildcardNode
	| UnnamedNode<"{">
	| UnnamedNode<"|">
	| UnnamedNode<"|>">
	| UnnamedNode<"|]">
	| UnnamedNode<"||">
	| UnnamedNode<"}">
	| UnnamedNode<"μ">
	| ErrorNode;

export type AtomNode =
	| HoleNode
	| InjectionNode
	| ListNode
	| LiteralNode
	| ParenthesizedNode
	| ProjectionNode
	| ResetNode
	| ResumeNode
	| RowNode
	| ShiftNode
	| StructNode
	| TaggedNode
	| TupleNode
	| VariableNode;

export type ExprNode = AnnotationNode | ApplicationNode | AtomNode | BlockNode | LambdaNode | MatchNode | OperationNode | TypeExprNode | UnaryNode;

export type PatternNode =
	| LiteralNode
	| PatternListNode
	| PatternRowNode
	| PatternStructNode
	| PatternTaggedNode
	| PatternTupleNode
	| VariableNode
	| WildcardNode;

export type StatementNode = ExprNode | ForeignNode | LetdecNode | UsingNode;

export type TypeExprNode = ArrowNode | DictNode | ModalNode | MuNode | PiNode | VariantNode;

export interface AlternativeNode extends NamedNodeBase {
	type: SyntaxType.Alternative;
	bodyNode: ExprNode;
	patternNode: PatternNode;
}

export interface AnnotationNode extends NamedNodeBase {
	type: SyntaxType.Annotation;
}

export interface ApplicationNode extends NamedNodeBase {
	type: SyntaxType.Application;
	argumentNode: AtomNode;
	functionNode: ExprNode;
}

export interface ArrowNode extends NamedNodeBase {
	type: SyntaxType.Arrow;
	codomainNode: ExprNode;
	domainNodes: (UnnamedNode<"("> | UnnamedNode<")"> | UnnamedNode<","> | ExprNode)[];
}

export interface AssignmentNode extends NamedNodeBase {
	type: SyntaxType.Assignment;
	keyNode: IdentifierNode;
	valueNode: ExprNode;
}

export interface BlockNode extends NamedNodeBase {
	type: SyntaxType.Block;
	returnNode?: ReturnStatementNode;
	statementsNodes: (UnnamedNode<";"> | StatementNode)[];
}

export interface BooleanNode extends NamedNodeBase {
	type: SyntaxType.Boolean;
}

export interface DictNode extends NamedNodeBase {
	type: SyntaxType.Dict;
}

export interface ExportsNode extends NamedNodeBase {
	type: SyntaxType.Exports;
}

export interface ForeignNode extends NamedNodeBase {
	type: SyntaxType.Foreign;
}

export interface ImportNode extends NamedNodeBase {
	type: SyntaxType.Import;
}

export interface InjectionNode extends NamedNodeBase {
	type: SyntaxType.Injection;
	recordNode?: ExprNode;
	updatesNodes: (UnnamedNode<","> | AssignmentNode)[];
}

export interface KeyNode extends NamedNodeBase {
	type: SyntaxType.Key;
}

export interface KeyValueNode extends NamedNodeBase {
	type: SyntaxType.KeyValue;
}

export interface LambdaNode extends NamedNodeBase {
	type: SyntaxType.Lambda;
	bodyNode: ExprNode;
	paramsNode: ParamsNode;
}

export interface LetdecNode extends NamedNodeBase {
	type: SyntaxType.Letdec;
	nameNode: IdentifierNode;
	typeNode?: ExprNode;
	valueNode: ExprNode;
}

export interface ListNode extends NamedNodeBase {
	type: SyntaxType.List;
	tailNodes: (IdentifierNode | UnnamedNode<"|">)[];
}

export interface LiteralNode extends NamedNodeBase {
	type: SyntaxType.Literal;
}

export interface MatchNode extends NamedNodeBase {
	type: SyntaxType.Match;
	branchNodes: AlternativeNode[];
	subjectNode: ExprNode;
}

export interface ModalNode extends NamedNodeBase {
	type: SyntaxType.Modal;
}

export interface ModuleNode extends NamedNodeBase {
	type: SyntaxType.Module;
}

export interface MuNode extends NamedNodeBase {
	type: SyntaxType.Mu;
	bodyNode: ExprNode;
	nameNode: IdentifierNode;
}

export interface NumberNode extends NamedNodeBase {
	type: SyntaxType.Number;
}

export interface OperationNode extends NamedNodeBase {
	type: SyntaxType.Operation;
}

export interface ParamNode extends NamedNodeBase {
	type: SyntaxType.Param;
}

export interface ParamsNode extends NamedNodeBase {
	type: SyntaxType.Params;
}

export interface ParenthesizedNode extends NamedNodeBase {
	type: SyntaxType.Parenthesized;
}

export interface PatternKeyValueNode extends NamedNodeBase {
	type: SyntaxType.PatternKeyValue;
}

export interface PatternListNode extends NamedNodeBase {
	type: SyntaxType.PatternList;
}

export interface PatternRowNode extends NamedNodeBase {
	type: SyntaxType.PatternRow;
}

export interface PatternStructNode extends NamedNodeBase {
	type: SyntaxType.PatternStruct;
}

export interface PatternTaggedNode extends NamedNodeBase {
	type: SyntaxType.PatternTagged;
	payloadNode: PatternNode;
	tagNode: IdentifierNode;
}

export interface PatternTupleNode extends NamedNodeBase {
	type: SyntaxType.PatternTuple;
}

export interface PiNode extends NamedNodeBase {
	type: SyntaxType.Pi;
	codomainNode: ExprNode;
	domainNodes: (UnnamedNode<"("> | UnnamedNode<")"> | UnnamedNode<","> | TypingNode)[];
}

export interface ProjectionNode extends NamedNodeBase {
	type: SyntaxType.Projection;
	keyNode: IdentifierNode;
	recordNode?: AtomNode;
}

export interface QuantityNode extends NamedNodeBase {
	type: SyntaxType.Quantity;
}

export interface ResetNode extends NamedNodeBase {
	type: SyntaxType.Reset;
}

export interface ResumeNode extends NamedNodeBase {
	type: SyntaxType.Resume;
}

export interface ReturnStatementNode extends NamedNodeBase {
	type: SyntaxType.ReturnStatement;
	valueNode: ExprNode;
}

export interface RowNode extends NamedNodeBase {
	type: SyntaxType.Row;
	tailNodes: (IdentifierNode | UnnamedNode<"|">)[];
}

export interface ScriptNode extends NamedNodeBase {
	type: SyntaxType.Script;
}

export interface ShiftNode extends NamedNodeBase {
	type: SyntaxType.Shift;
}

export interface SourceFileNode extends NamedNodeBase {
	type: SyntaxType.SourceFile;
}

export interface StructNode extends NamedNodeBase {
	type: SyntaxType.Struct;
	tailNodes: (IdentifierNode | UnnamedNode<"|">)[];
}

export interface TaggedNode extends NamedNodeBase {
	type: SyntaxType.Tagged;
	payloadNode: ExprNode;
	tagNode: IdentifierNode;
}

export interface TupleNode extends NamedNodeBase {
	type: SyntaxType.Tuple;
	tailNodes: (IdentifierNode | UnnamedNode<"|">)[];
}

export interface TypingNode extends NamedNodeBase {
	type: SyntaxType.Typing;
}

export interface UnaryNode extends NamedNodeBase {
	type: SyntaxType.Unary;
}

export interface UsingNode extends NamedNodeBase {
	type: SyntaxType.Using;
}

export interface VariableNode extends NamedNodeBase {
	type: SyntaxType.Variable;
}

export interface VariantNode extends NamedNodeBase {
	type: SyntaxType.Variant;
}

export interface CommentNode extends NamedNodeBase {
	type: SyntaxType.Comment;
}

export interface ExplicitArrowNode extends NamedNodeBase {
	type: SyntaxType.ExplicitArrow;
}

export interface FieldNode extends NamedNodeBase {
	type: SyntaxType.Field;
}

export interface HoleNode extends NamedNodeBase {
	type: SyntaxType.Hole;
}

export interface IdentifierNode extends NamedNodeBase {
	type: SyntaxType.Identifier;
}

export interface ImplicitApplicationNode extends NamedNodeBase {
	type: SyntaxType.ImplicitApplication;
}

export interface ImplicitArrowNode extends NamedNodeBase {
	type: SyntaxType.ImplicitArrow;
}

export interface IndexNode extends NamedNodeBase {
	type: SyntaxType.Index;
}

export interface LabelNode extends NamedNodeBase {
	type: SyntaxType.Label;
}

export interface StringNode extends NamedNodeBase {
	type: SyntaxType.String;
}

export interface WildcardNode extends NamedNodeBase {
	type: SyntaxType.Wildcard;
}
