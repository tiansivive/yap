@preprocessor typescript

@{%
	// Moo lexer documention is here:
	// https://github.com/no-context/moo

	import moo from "moo";
	import Shared from "../shared";
	import * as Src from "./src";
	import * as Con from "./constructors";

	const lexer = moo.compile({
	  	number: /[0-9]+/,
	  	variable: { match: /[a-zA-Z][a-zA-Z0-9]*/, type: moo.keywords({ ret: "return", dec: "let", match: "match", Type: "Type", Unit: "Unit" }) },
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

TypeExpr -> Pi 			{% id %}
	  	  | Variant 	{% id %} 
	  	  | App 		{% id %}

App -> App %ws Expr 				{% Con.Application %}
	 | App %ws:? %op %ws:? Expr 	{% Con.Operation %}
     | Expr 						{% id %}

Expr -> Lambda		{% id %}
      | Match 		{% id %}
	  | Block 		{% id %}
	  | Struct 		{% id %}
	  | Row 		{% id %}	
      | Tuple 		{% id %}
	  | List 		{% id %}
	  | Atom 		{% id %}

Atom -> Identifier 		{% Con.Var %} 
	  | Literal 		{% Con.Lit %}
	  | %hole 			{% Con.Hole %}
	  | Parens[Ann]  	{% Con.extract %}


# FUNCTIONS
Lambda -> %backslash Param %ws %arrow %ws Expr 			{% Con.Lambda %}
		| %backslash %hash Param %ws %fatArrow %ws Expr {% Con.Lambda %}
		
Param -> Identifier 													{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? Expr 							{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? Angle[Quantity] %ws:? Expr 		{% Con.Param %}
	   | Parens[Param] 													{% Con.extract %}
		 

Pi -> Expr %ws:? %arrow %ws PiTail 		{% Con.Pi("Explicit") %}
	| Expr %ws:? %fatArrow %ws PiTail 	{% Con.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Atom {% id %}

# ROWS
Struct -> Empty[%lbrace, %rbrace] 				{% Con.emptyStruct %}
	 	| Curly[ Many[KeyVal, %comma] ] 		{% Con.struct %}

Variant -> %bar Many[KeyVal, %bar]				{% Con.Variant %}

Row -> Empty[%lbracket, %rbracket] 				{% Con.emptyRow %}
	 | Square[ Many[KeyVal, %comma] ] 			{% Con.row %}

KeyVal -> Identifier %ws:? %colon %ws:? Expr 	{% Con.keyval %}


Tuple -> Curly[ Many[Expr, %comma] ] 			{% Con.tuple %}
List ->  Square[ Many[Expr, %comma] ] 			{% Con.list %}

# BLOCKS
Block -> Curly[ Many[Statement, %semicolon] %semicolon Return:? ] 		{% Con.Block %}
	   | Curly[ Return ] 												{% Con.Block %}

Statement -> Expr 			{% Con.Expr %}
           | Letdec			{% id %}

Return    -> %NL:? %ws:? "return" %ws:+ Expr %semicolon 	{% Con.Return %}

Letdec -> "let" %ws Identifier %ws:? %equals %ws:? Expr 						{% Con.LetDec %}
		| "let" %ws Identifier %ws:? %colon %ws:? Expr %ws:? %equals %ws:? Expr {% Con.LetDec %}


# VARIABLES
Identifier -> %variable {% Con.Name %}

# Multiplicity
Quantity -> "1" {% () => Shared.One %}
		  | "0" {% () => Shared.Zero %}
		  | "*" {% () => Shared.Many %}

# PATTERN MATCHING
Match -> "match" %ws Expr Alt:+ {% d => ({ type: "match", scrutinee: d[2], alternatives: d[3] }) %} 
Alt -> %NL:? %ws:? %bar %ws Pattern %ws %arrow %ws Expr {% d => ({ type: "alternative", pattern: d[4], body: d[8] }) %}


Pattern -> Identifier {% d => ({ type: "Var", binding: d[0] }) %}

# LITERALS
Literal 
	-> String {% ([s]) => Shared.String(s) %}
	 | Number {% ([n]) => Shared.Num(n) %}
	 | "Type" {% () => Shared.Type() %}
	 | "Unit" {% () => Shared.Unit() %}
	  
Number 
	-> Int %dot Int {% d => parseFloat(d.join(''))  %}
	 | Int			{% d => parseInt(d)  %}

Int -> %number  {% id %}
String -> %string {% d => d[0].value.slice(1, -1) %}
