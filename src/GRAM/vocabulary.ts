export const Tags = {
	ROOT: "root",
	LIT: "lit",

	VAR_BOUND: "var:bound",
	VAR_FREE: "var:free",
	VAR_FOREIGN: "var:foreign",
	VAR_LABEL: "var:label",
	VAR_META: "var:meta",
	VAR_REF: "var:ref",

	LAMBDA: "lambda",
	PI: "pi",
	SIGMA: "sigma",
	MU: "mu",
	LET: "let",
	APP: "app",

	ROW_EXT: "row:ext",
	ROW_EMPTY: "row:empty",
	ROW_VAR: "row:var",
	STRUCT: "struct",

	PROJ: "proj",
	INJ: "inj",
	MATCH: "match",
	CASE: "case",

	PAT_VARIANT: "pat:variant",
	PAT_STRUCT: "pat:struct",
	PAT_LIT: "pat:lit",
	PAT_BINDER: "pat:binder",
	PAT_WILDCARD: "pat:wildcard",

	BLOCK: "block",
	STMT_LET: "stmt:let",
	STMT_EXPR: "stmt:expr",
	STMT_USING: "stmt:using",

	MODAL: "modal",
	RESET: "reset",
	SHIFT: "shift",
	BUBBLE: "bubble",
	CONTINUATION: "continuation",
	RESUMPTION: "resumption",

	SWITCH: "switch",
	LEAF: "leaf",
	FAIL: "fail",

	EXTERNAL: "external",
	PRIMOP: "primop",
	PAP: "pap",
	CLOSURE: "closure",
	ENV: "env",
	FUNC: "func",
	DIRECT_CALL: "direct_call",
	INDIRECT_CALL: "indirect_call",
} as const;

export const TypeTags = {
	VAR: "type:var",
	LIT: "type:lit",
	APP: "type:app",
	PI: "type:pi",
	SIGMA: "type:sigma",
	LAMBDA: "type:lambda",
	MU: "type:mu",
	ROW_EXT: "type:row:ext",
	ROW_EMPTY: "type:row:empty",
	NEUTRAL: "type:neutral",
	MODAL: "type:modal",
	CLOSURE: "type:closure",
	EXTERNAL: "type:external",
} as const;

export type Tag = string;

export const Labels = {
	BODY: ":body",
	FUNC: ":func",
	ARG: ":arg",
	ANNOTATION: ":annotation",
	VALUE: ":value",
	REST: ":rest",
	TAIL: ":tail",
	TARGET: ":target",
	SCRUTINEE: ":scrutinee",
	RETURN: ":return",
	TERM: ":term",
	ENTRY: ":entry",
	SCOPE: ":scope",
	REFERS_TO: ":refers_to",
	HAS_TYPE: ":has_type",
	DERIVED_FROM: ":derived_from",
	FN: ":fn",
	ENV: ":env",
	CALLEE: ":callee",

	STMT: ":stmt",
	ALT: ":alt",
	CAPTURE: ":capture",
	NEXT: ":next",

	PATTERN: ":pattern",
	PAYLOAD: ":payload",
	FIELD: ":field",

	DECISION_TREE: ":decision_tree",
	BRANCH: ":branch",
	DEFAULT: ":default",
	INSPECT: ":inspect",
	BIND: ":bind",

	DELIMITER: ":delimiter",
	CAPTURED_AT: ":captured_at",
	HANDLER: ":handler",
	PARAM: ":param",
	INVOKES: ":invokes",

	MATERIALIZES: ":materializes",
	CAPTURED: ":captured",
} as const;

export type Label = string;

const STRUCTURAL: ReadonlySet<string> = new Set([
	Labels.BODY,
	Labels.FUNC,
	Labels.ARG,
	Labels.ANNOTATION,
	Labels.VALUE,
	Labels.REST,
	Labels.TARGET,
	Labels.SCRUTINEE,
	Labels.RETURN,
	Labels.TERM,
	Labels.ENTRY,
	Labels.STMT,
	Labels.ALT,
	Labels.PATTERN,
	Labels.PAYLOAD,
	Labels.FIELD,
]);

export const isStructural = (label: Label): boolean => STRUCTURAL.has(label);
