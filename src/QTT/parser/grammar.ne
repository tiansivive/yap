@preprocessor typescript

@{%
	// Moo lexer documentation is here:
	// https://github.com/no-context/moo

	import moo from "moo";
	import * as Q from "@qtt/shared/modalities/multiplicity";
	import * as Lit from "@qtt/shared/literals";
	import * as Con from "./constructors";

	const lexer = moo.compile({
	  	number: /[0-9]+/,
	  	variable: { match: /[a-zA-Z][a-zA-Z0-9]*/, type: moo.keywords({ ret: "return", dec: "let", match: "match", Type: "Type", Unit: "Unit", Row: "Row" }) },
	  	string: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/,
	  	dot: /\./,
		equals: /\=(?!>)/,
	  	backslash: /\\/,
	  	arrow: /->/,
		fatArrow: /\=>/,
		op: /[\+\-\*\/]/,
		ws: /[ \t]+/,
		lparens: /\(/,
		rparens: /\)/,
		lbrace: /\{/,
		rbrace: /\}/,
		langle: /</,
		rangle: />/,
		lbracket: /\[/,
		rbracket: /\]/,
		semicolon: /\;/,
		colon: /\:/,
		comma: /\,/,
		bar: /\|/,
		hash: /#/,
		hole: /_/,
		NL: { match: /\n+/, lineBreaks: true },

	});
%}

# Pass your lexer with @lexer:
@lexer lexer

# Declaration
# Def -> "def" %ws Identifier %ws %equals %ws:? Expr %ws:? %semicolon {% d => ({ type: "def", binding: d[2], value: d[6] }) %}

# Parens[X] 	-> %lparens %ws:? $X %ws:? %rparens 	{% Con.unwrapParenthesis %}
# Angles[X] 	-> %langle %ws:? $X %ws:? %rangle 		{% Con.unwrapAngles %}
# Curly[X] 	-> %lbrace $X %ws:? %NL:? %rbrace 		{% Con.unwrapCurlyBraces %} 
# Square[X] 	-> %lbracket $X %ws:? %NL:? %rbracket 	{% Con.unwrapSquareBrackets %}
# Separate[X, EndSymbol] -> %NL:? %ws:? $X %NL:? %ws:? $EndSymbol {% Con.unwrapSeparator %}

Empty[X, Y] -> $X %NL:? %ws:? %NL:? $Y 												{% Con.none %}
Wrap[X, L, R] -> $L $X %ws:? $R 													{% Con.unwrap %}

Many[X, Separator] 	-> (%NL:? %ws:? $X %NL:? %ws:? $Separator):* %NL:? %ws:? $X 	{% Con.many %}
Prefixed[Prefix, X] -> $Prefix %ws:? $X 											{% Con.prefix %}
Suffixed[X, Suffix] -> $X %ws:? $Suffix 											{% Con.suffix %}

Parens[X] -> Wrap[$X, %lparens, %rparens] 		{% id %}
Angle[X] -> Wrap[$X, %langle, %rangle] 			{% id %}
Curly[X] -> Wrap[$X, %lbrace, %rbrace] 			{% id %}
Square[X] -> Wrap[$X, %lbracket, %rbracket] 	{% id %}



Script -> Statement:+ %NL:? {% d => ({ type: "script", script: d[0] }) %}
		| Ann 				{% id %}

Ann -> Ann %ws:? %colon %ws:? TypeExpr 							{% Con.Annotation %}
     | Ann %ws:? %colon %ws:? Angle[Quantity] %ws:? TypeExpr 	{% Con.Annotation %}
	 | TypeExpr 												{% id %}

TypeExpr -> Pi 				{% id %}
		  | Mu 				{% id %}
	  	  | Variant 		{% id %} 
		  | Schema 			{% id %}
		  | Row 			{% id %}	
	  	  | Expr 			{% id %}

Expr -> Lambda		{% id %}
      | Match 		{% id %}
	  | Block 		{% id %}
	  | App 		{% id %}

App -> App %ws Expr 				{% Con.Application %}
	 | App %ws:? %op %ws:? Expr 	{% Con.Operation %}
     | Atom 						{% id %}

Atom -> Identifier 		{% Con.Var %} 
	  | %hole 			{% Con.Hole %}
	  | Projection 		{% id %}
	  | Injection 		{% id %}
	  | Literal 		{% Con.Lit %}
	  | Struct 			{% id %}
      | Tuple 			{% id %}
	  | List 			{% id %}
	  | Parens[Ann]  	{% Con.extract %}

# ------------------------------------
# RECURSIVE TYPES
# ------------------------------------

Mu -> "μ" %ws:? Identifier %ws:? %arrow %ws:? TypeExpr 		{% Con.Mu %}

# ------------------------------------
# FUNCTIONS
# ------------------------------------
Lambda -> %backslash Param %ws %arrow %ws TypeExpr 				{% Con.Lambda %}
		| %backslash %hash Param %ws %fatArrow %ws TypeExpr 	{% Con.Lambda %}
		
Param -> Identifier 													{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? TypeExpr 							{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? Angle[Quantity] %ws:? TypeExpr 		{% Con.Param %}
	   | Parens[Param] 													{% Con.extract %}
		 

Pi -> TypeExpr %ws:? %arrow %ws PiTail 		{% Con.Pi("Explicit") %}
	| TypeExpr %ws:? %fatArrow %ws PiTail 	{% Con.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Atom {% id %}


# ------------------------------------
# ROW TERMS
# ------------------------------------
Row -> Empty[%lbracket, %rbracket] 					{% Con.emptyRow %}
	 | Square[ Many[KeyVal, %comma] RowTail:? ] 	{% Con.row %}

RowTail -> %ws:? %bar %ws:? Identifier 				{% d => d[3] %}

# Values
Struct -> Empty[%lbrace, %rbrace] 					{% Con.emptyStruct %}
	 	| Curly[ Many[KeyVal, %comma] ] 			{% Con.struct %}

Tuple -> Curly[ Many[TypeExpr, %comma] ] 				{% Con.tuple %}
List -> Square[ Many[TypeExpr, %comma] ] 				{% Con.list %}

# Types
Schema -> Curly[ Many[SchemaPair, %comma] RowTail:? ] 	{% Con.schema %}

Variant -> %bar Many[KeyVal, %bar]						{% Con.Variant %}

# Fields
KeyVal -> Identifier %ws:? %colon %ws:? TypeExpr 				{% Con.keyval %}
SchemaPair -> Identifier %ws:? %colon %colon %ws:? TypeExpr 		{% Con.keyval %}
Assignment -> Identifier %ws:? %equals %ws:? TypeExpr 			{% Con.keyval %}

Projection -> TypeExpr %dot Identifier 									{% Con.Projection %}
			| %dot Identifier 										{% Con.Projection %}

Injection -> Curly[ %ws:? TypeExpr %ws:? %bar Many[Assignment, %comma] ] 	{% Con.Injection %}
		   | Curly[ %ws:? %bar Many[Assignment, %comma] ] 				{% Con.Injection %}


# ------------------------------------
# Blocks
# ------------------------------------
Block -> Curly[ Many[Statement, %semicolon] %semicolon Return:? ] 		{% Con.Block %}
	   | Curly[ Return ] 												{% Con.Block %}

Statement -> Ann 			{% Con.Expr %}
           | Letdec			{% id %}

Return    -> %NL:? %ws:? "return" %ws:+ Ann %semicolon 					{% Con.Return %}

Letdec -> "let" %ws Identifier %ws:? %equals %ws:? Ann 										{% Con.LetDec %}
		| "let" %ws Identifier %ws:? %colon %ws:? TypeExpr %ws:? %equals %ws:? TypeExpr 	{% Con.LetDec %}


# VARIABLES
Identifier -> %variable {% Con.Name %}

# Multiplicity
Quantity -> "1" {% () => Q.One %}
		  | "0" {% () => Q.Zero %}
		  | "*" {% () => Q.Many %}

# ------------------------------------
# Pattern Matching
# ------------------------------------
Match -> "match" %ws:+ TypeExpr Alt:+ 							{% Con.Match %} 
Alt -> %NL:? %ws:? %bar %ws:? Pattern %ws:? %arrow %ws:? TypeExpr 	{% Con.Alternative %}


Pattern -> Identifier 									{% Con.Pattern %}
		 | Literal 										{% Con.Pattern %}
		 | Curly[ Many[PatKeyVal, %comma] RowTail:? ] 	{% Con.Pattern %}
		 | Parens[Pattern] 	{% Con.extract %}

PatKeyVal -> Identifier %ws:? %colon %ws:? Pattern 		{% Con.keyvalPat %}

# ------------------------------------
# Literals
# ------------------------------------
Literal 
	-> String {% ([s]) => Lit.String(s) %}
	 | Number {% ([n]) => Lit.Num(n) %}
	 | "Type" {% () => Lit.Type() %}
	 | "Unit" {% () => Lit.Unit() %}
	 | "Row" {% () => Lit.Row() %}
	  
Number 
	-> Int %dot Int {% d => parseFloat(d.join(''))  %}
	 | Int			{% d => parseInt(d)  %}

Int -> %number  {% id %}
String -> %string {% d => d[0].value.slice(1, -1) %}
