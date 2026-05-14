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

	PROJ: "proj",
	INJ: "inj",
	MATCH: "match",
	CASE: "case",

	BLOCK: "block",
	STMT_LET: "stmt:let",
	STMT_EXPR: "stmt:expr",
	STMT_USING: "stmt:using",

	MODAL: "modal",
	RESET: "reset",
	SHIFT: "shift",

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
	TARGET: ":target",
	SCRUTINEE: ":scrutinee",
	RETURN: ":return",
	TERM: ":term",
	ENTRY: ":entry",
	REFERS_TO: ":refers_to",
	HAS_TYPE: ":has_type",
	DERIVED_FROM: ":derived_from",
	FN: ":fn",
	ENV: ":env",
	CALLEE: ":callee",

	captureN: (n: number): string => `:capture_${n}`,

	caseN: (n: number): string => `:case_${n}`,
	stmtN: (n: number): string => `:stmt_${n}`,
} as const;

export type Label = string;
