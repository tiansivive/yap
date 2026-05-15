import * as PP from "prettier-printer";

export type Doc = PP.IDoc;

const DEFAULT_WIDTH = 80;

export const render = (doc: Doc, maxCols = DEFAULT_WIDTH): string => PP.render(maxCols, doc);

export const parensIf = (cond: boolean, doc: Doc): Doc => (cond ? PP.enclose(PP.parens, doc) : doc);

export const binder = (sym: Doc, arrow: string, body: Doc): Doc => PP.group([sym, " ", arrow, PP.nest(2, [PP.line, body])]);

export const app = (fn: Doc, icit: string, arg: Doc): Doc => PP.group([fn, PP.nest(2, [PP.line, icit, arg])]);

export const row = (fields: Doc[], tail?: Doc): Doc => {
	if (fields.length === 0 && !tail) {
		return "[]";
	}

	if (fields.length === 0 && tail) {
		return PP.group(["[ ", tail, " ]"]);
	}
	const sep = [",", PP.line];
	const inner = tail ? [...PP.intersperse(sep, fields), " ", tail] : PP.intersperse(sep, fields);
	return PP.group(["[", PP.nest(2, [" ", ...inner, " "]), "]"]);
};

export const block = (stmts: Doc[], ret: Doc): Doc =>
	PP.group(["{", PP.nest(2, [...stmts.map(s => [PP.line, s, ";"]), PP.line, "return ", ret, ";"]), PP.line, "}"]);

export const matchDoc = (scrutinee: Doc, alts: Doc[]): Doc =>
	PP.group([
		"match ",
		scrutinee,
		PP.nest(
			2,
			alts.map(a => [PP.line, a]),
		),
	]);

export const alt = (pat: Doc, body: Doc): Doc => PP.group(["| ", pat, " ->", PP.nest(4, [PP.line, body])]);

export const list = (elems: Doc[]): Doc => {
	if (elems.length === 0) {
		return "[]";
	}
	return PP.group(["[", PP.nest(2, [" ", ...PP.intersperse([",", PP.line], elems), " "]), "]"]);
};

export const letBinding = (name: string, ann: Doc | null, value: Doc): Doc =>
	PP.group(["let ", name, ...(ann ? [PP.nest(2, [PP.line, ": ", ann])] : []), PP.nest(2, [PP.line, "= ", value])]);

export const closure = (body: Doc, env: Doc): Doc => ["(closure: ", body, " -| ", env, ")"];

export const enclose = PP.enclose;
export const braces = PP.braces;
export const parens = PP.parens;
export const brackets = PP.brackets;
export const angles = PP.angles;
export const group = PP.group;
export const nest = PP.nest;
export const line = PP.line;
export const lineBreak = PP.lineBreak;
export const softLine = PP.softLine;
export const intersperse = PP.intersperse;
