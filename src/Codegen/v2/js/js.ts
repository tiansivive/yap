export type Expr =
	| { type: "Literal"; value: number | boolean | string | null }
	| { type: "Identifier"; name: string }
	| { type: "Binary"; op: string; left: Expr; right: Expr }
	| { type: "Unary"; op: string; arg: Expr }
	| { type: "Call"; callee: Expr; args: Expr[] }
	| { type: "Member"; object: Expr; property: string }
	| { type: "Object"; fields: Array<{ key: string; value: Expr; spread?: boolean }> }
	| { type: "Assign"; target: Expr; value: Expr };

export type Stmt =
	| { type: "Const"; name: string; value: Expr }
	| { type: "Let"; name: string; value?: Expr }
	| { type: "ExprStmt"; expr: Expr }
	| { type: "Return"; value: Expr }
	| { type: "If"; condition: Expr; body: Stmt[] }
	| { type: "Switch"; discriminant: Expr; cases: Array<{ test: Expr; body: Stmt[] }> }
	| { type: "While"; condition: Expr; body: Stmt[] }
	| { type: "Break" };

export type Decl = { type: "Function"; name: string; params: string[]; body: Stmt[] };

export type Program = { declarations: Decl[]; body: Stmt[] };

export const Lit = (value: number | boolean | string | null): Expr => ({ type: "Literal", value });
export const Id = (name: string): Expr => ({ type: "Identifier", name });
export const Bin = (op: string, left: Expr, right: Expr): Expr => ({ type: "Binary", op, left, right });
export const Un = (op: string, arg: Expr): Expr => ({ type: "Unary", op, arg });
export const Call = (callee: Expr, args: Expr[]): Expr => ({ type: "Call", callee, args });
export const Member = (object: Expr, property: string): Expr => ({ type: "Member", object, property });
export const Obj = (fields: Array<{ key: string; value: Expr; spread?: boolean }>): Expr => ({ type: "Object", fields });
export const Spread = (key: string, value: Expr): { key: string; value: Expr; spread: true } => ({ key, value, spread: true });
export const Assign = (target: Expr, value: Expr): Expr => ({ type: "Assign", target, value });

export const Const = (name: string, value: Expr): Stmt => ({ type: "Const", name, value });
export const Let = (name: string, value?: Expr): Stmt => ({ type: "Let", name, value });
export const ExprStmt = (expr: Expr): Stmt => ({ type: "ExprStmt", expr });
export const Return = (value: Expr): Stmt => ({ type: "Return", value });
export const If = (condition: Expr, body: Stmt[]): Stmt => ({ type: "If", condition, body });
export const Switch = (discriminant: Expr, cases: Array<{ test: Expr; body: Stmt[] }>): Stmt => ({ type: "Switch", discriminant, cases });
export const While = (condition: Expr, body: Stmt[]): Stmt => ({ type: "While", condition, body });
export const Break: Stmt = { type: "Break" };

export const Fn = (name: string, params: string[], body: Stmt[]): Decl => ({ type: "Function", name, params, body });
export const Program = (declarations: Decl[], body: Stmt[]): Program => ({ declarations, body });
