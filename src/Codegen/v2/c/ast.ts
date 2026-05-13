export type Expr =
	| { type: "Literal"; value: string }
	| { type: "Identifier"; name: string }
	| { type: "Call"; callee: Expr; args: Expr[] }
	| { type: "Index"; array: Expr; index: Expr }
	| { type: "Ref"; target: Expr }
	| { type: "CompoundLiteral"; typeName: string; fields: Expr[] }
	| { type: "Cast"; typeName: string; expr: Expr }
	| { type: "Assign"; target: Expr; value: Expr };

export type Stmt =
	| { type: "VarDecl"; typeName: string; name: string; init?: Expr }
	| { type: "ExprStmt"; expr: Expr }
	| { type: "Return"; value: Expr }
	| { type: "If"; condition: Expr; body: Stmt[] }
	| { type: "Switch"; discriminant: Expr; cases: Array<{ value: number; body: Stmt[] }> }
	| { type: "While"; condition: Expr; body: Stmt[] }
	| { type: "Break" }
	| { type: "Block"; body: Stmt[] };

export type Function = {
	type: "Function";
	returnType: string;
	name: string;
	params: Array<{ typeName: string; name: string }>;
	body: Stmt[];
	isStatic: boolean;
};

export type Include = { type: "Include"; path: string };
export type ForwardDecl = {
	type: "ForwardDecl";
	returnType: string;
	name: string;
	params: Array<{ typeName: string; name: string }>;
	isStatic: boolean;
};

export type TopLevel = Include | Function | ForwardDecl;

export type Program = { items: TopLevel[] };

// --- Expr constructors ---

export const Lit = (value: string): Expr => ({ type: "Literal", value });
export const Num = (n: number): Expr => Lit(String(n));
export const Str = (s: string): Expr => Lit(`"${s}"`);
export const Id = (name: string): Expr => ({ type: "Identifier", name });
export const Call = (callee: Expr, args: Expr[]): Expr => ({ type: "Call", callee, args });
export const Invoke = (name: string, args: Expr[]): Expr => Call(Id(name), args);
export const Index = (array: Expr, index: Expr): Expr => ({ type: "Index", array, index });
export const Ref = (target: Expr): Expr => ({ type: "Ref", target });
export const Compound = (typeName: string, fields: Expr[]): Expr => ({ type: "CompoundLiteral", typeName, fields });
export const Assign = (target: Expr, value: Expr): Expr => ({ type: "Assign", target, value });

// --- Stmt constructors ---

export const Var = (typeName: string, name: string, init?: Expr): Stmt => ({ type: "VarDecl", typeName, name, init });
export const ExprStmt = (expr: Expr): Stmt => ({ type: "ExprStmt", expr });
export const Return = (value: Expr): Stmt => ({ type: "Return", value });
export const If = (condition: Expr, body: Stmt[]): Stmt => ({ type: "If", condition, body });
export const Switch = (discriminant: Expr, cases: Array<{ value: number; body: Stmt[] }>): Stmt => ({ type: "Switch", discriminant, cases });
export const While = (condition: Expr, body: Stmt[]): Stmt => ({ type: "While", condition, body });
export const Break: Stmt = { type: "Break" };
export const Block = (body: Stmt[]): Stmt => ({ type: "Block", body });

// --- TopLevel constructors ---

export const Include = (path: string): Include => ({ type: "Include", path });
export const Fn = (
	name: string,
	params: Array<{ typeName: string; name: string }>,
	body: Stmt[],
	opts?: { returnType?: string; isStatic?: boolean },
): Function => ({
	type: "Function",
	returnType: opts?.returnType ?? "YapValue",
	name,
	params,
	body,
	isStatic: opts?.isStatic ?? true,
});

export const Forward = (fn: Function): ForwardDecl => ({
	type: "ForwardDecl",
	returnType: fn.returnType,
	name: fn.name,
	params: fn.params,
	isStatic: fn.isStatic,
});

export const Program = (items: TopLevel[]): Program => ({ items });
