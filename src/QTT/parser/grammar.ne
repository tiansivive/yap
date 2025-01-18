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
		semicolon: /\;/,
		colon: /\:/,
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

Parens[X] -> %lparens %ws:? $X %ws:? %rparens {% Con.unwrapParenthesis %}
Angles[X] -> %langle %ws:? $X %ws:? %rangle {% Con.unwrapAngles %}

Script -> Statement:+ %NL:? {% d => ({ type: "script", script: d[0] }) %}
		| Expr {% id %}

Expr 
	-> Lambda		{% id %}
	 | Ann 			{% id %}
     | Match 		{% id %}
	 | Block 		{% id %}
	 | App 			{% id %}
	 | Pi			{% id %}
	 | %hole 		{% Con.Hole %}
	 
App -> App %ws Atom 				{% Con.Application %}
	 | App %ws:? %op %ws:? Atom 	{% Con.Operation %}
     | Atom 						{% id %}



Atom -> Literal 		{% Con.Lit %}
	  | Identifier 		{% Con.Var %} 
	  | Parens[Expr]  	{% id %}

	 
Ann -> Expr %ws:? %colon %ws:? Atom 						{% Con.Annotation %}
     | Expr %ws:? %colon %ws:? Angles[Quantity] %ws:? Atom 	{% Con.Annotation %}

# FUNCTIONS
Lambda -> %backslash Param %ws %arrow %ws Expr 			{% Con.Lambda %}
		| %backslash %hash Param %ws %fatArrow %ws Expr {% Con.Lambda %}
		
Param -> Identifier 													{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? Expr 							{% Con.Param %}
	   | Identifier %ws:? %colon %ws:? Angles[Quantity] %ws:? Expr 		{% Con.Param %}
	   | Parens[Param] 													{% id %}
		 

Pi -> Expr %ws:? %arrow %ws PiTail 		{% Con.Pi("Explicit") %}
	| Expr %ws:? %fatArrow %ws PiTail 	{% Con.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Atom {% id %}

# BLOCKS
Wrap[X] -> %NL:? %ws:? $X %NL:? %ws:? %semicolon {% Con.unwrapStatement %}
Curly[X] -> %lbrace $X %ws:? %NL:? %rbrace {% Con.unwrapCurlyBraces %} 

Block -> Curly[Statement:* Wrap[Return]:?] 	{% Con.Block %}

Statement -> Wrap[Expr] 	{% Con.Expr %}
           | Wrap[Letdec] 	{% id %}
		   
		   
Return    -> "return" %ws Expr {% Con.Return %}

Letdec -> "let" %ws Identifier %ws:? %equals %ws:? Expr {% Con.LetDec %}
		| "let" %ws Identifier %ws:? %colon %ws:? Expr %ws:? %equals %ws:? Expr {% Con.LetDec %}


# VARIABLES
Identifier -> %variable {% Con.Name %}

# Multiplicity
Quantity -> "1" {% () => Shared.One %}
		  | "0" {% () => Shared.Zero %}

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
