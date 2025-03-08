@preprocessor typescript

@{%
	// Moo lexer documentation is here:
	// https://github.com/no-context/moo

	import moo from "moo";
	import * as Q from "@qtt/shared/modalities/multiplicity";
	import * as Lit from "@qtt/shared/literals";
	import * as P from "./processors";

	const lexer = moo.compile({
	  	digit: { match: /[0-9]+/, value: s => parseInt(s) },
	  	string: { match: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/, value: s => s.slice(1, -1) },
	  	variable: { match: /[a-zA-Z][a-zA-Z0-9]*/, type: moo.keywords({ ret: "return", dec: "let", match: "match", Type: "Type", Unit: "Unit", Row: "Row" }) },
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

Empty[X, Y] -> $X %NL:? %ws:? %NL:? $Y 												{% P.none %}
Wrap[X, L, R] -> $L $X %ws:? $R 													{% P.unwrap %}

Many[X, Separator] 	-> (%NL:? %ws:? $X %NL:? %ws:? $Separator):* %NL:? %ws:? $X 	{% P.many %}
Prefixed[Prefix, X] -> $Prefix %ws:? $X 											{% P.prefix %}
Suffixed[X, Suffix] -> $X %ws:? $Suffix 											{% P.suffix %}

Parens[X] -> Wrap[$X, %lparens, %rparens] 		{% P.enclosed %}
Angle[X] -> Wrap[$X, %langle, %rangle] 			{% P.enclosed %}
Curly[X] -> Wrap[$X, %lbrace, %rbrace] 			{% P.enclosed %}
Square[X] -> Wrap[$X, %lbracket, %rbracket] 	{% P.enclosed %}



Script -> Many[Statement, %semicolon] %semicolon %NL:?  		{% P.script %}
		#| Ann 				{% id %}

Ann -> Ann %ws:? %colon %ws:? TypeExpr 							{% P.Annotation %}
     | Ann %ws:? %colon %ws:? Angle[Quantity] %ws:? TypeExpr 	{% P.Annotation %}
	 | TypeExpr 												{% id %}

TypeExpr -> Pi 			{% id %}
		  | Type 		{% id %}

Type -> Mu 				{% id %}
	  | Variant 		{% id %} 
	  | Schema 			{% id %}
	  | Row 			{% id %}	
	  | Expr 			{% id %}

Expr -> Lambda		{% id %}
      | Match 		{% id %}
	  | Block 		{% id %}
	  | App 		{% id %}

App -> App %ws Atom 				{% P.Application %}
	 | App %ws:? %op %ws:? Atom 	{% P.Operation %}
     | Atom 						{% id %}

Atom -> Identifier 		{% P.Var %} 
	  | %hole 			{% P.Hole %}
	  | Projection 		{% id %}
	  | Injection 		{% id %}
	  | Literal 		{% P.Lit %}
	  | Struct 			{% id %}
      | Tuple 			{% id %}
	  | List 			{% id %}
	  | Tagged 			{% id %}
	  | Parens[Ann]  	{% P.extract %}

# ------------------------------------
# RECURSIVE TYPES
# ------------------------------------

Mu -> "μ" %ws:? Identifier %ws:? %arrow %ws:? TypeExpr 		{% P.Mu %}

# ------------------------------------
# FUNCTIONS
# ------------------------------------
Lambda -> %backslash Param %ws %arrow %ws TypeExpr 				{% P.Lambda %}
		| %backslash %hash Param %ws %fatArrow %ws TypeExpr 	{% P.Lambda %}
		
Param -> Identifier 													{% P.Param %}
	   | Identifier %ws:? %colon %ws:? TypeExpr 							{% P.Param %}
	   | Identifier %ws:? %colon %ws:? Angle[Quantity] %ws:? TypeExpr 		{% P.Param %}
	   | Parens[Param] 													{% P.extract %}
		 

Pi -> Type %ws:? %arrow %ws:? PiTail 		{% P.Pi("Explicit") %}
	| Type %ws:? %fatArrow %ws:? PiTail 	{% P.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Type {% id %}


# ------------------------------------
# ROW TERMS
# ------------------------------------
Row -> Empty[%lbracket, %rbracket] 					{% P.emptyRow %}
	 | Square[ Many[KeyVal, %comma] RowTail:? ] 	{% P.row %}

RowTail -> %ws:? %bar %ws:? Identifier 				{% d => d[3] %}

# Values
Struct -> Empty[%lbrace, %rbrace] 					{% P.emptyStruct %}
	 	| Curly[ Many[KeyVal, %comma] ] 			{% P.struct %}

Tuple -> Curly[ Many[TypeExpr, %comma] ] 				{% P.tuple %}
List -> Square[ Many[TypeExpr, %comma] ] 				{% P.list %}

# Types
Schema -> Curly[ Many[SchemaPair, %comma] RowTail:? ] 	{% P.schema %}

Variant -> %bar Many[KeyVal, %bar]						{% P.variant %}

# Fields
KeyVal -> Identifier %ws:? %colon %ws:? TypeExpr 				{% P.keyval %}
SchemaPair -> Identifier %ws:? %colon %colon %ws:? TypeExpr 	{% P.keyval %}
Assignment -> Identifier %ws:? %equals %ws:? TypeExpr 			{% P.keyval %}

Projection -> TypeExpr %dot Identifier 									{% P.Projection %}
			| %dot Identifier 										{% P.Projection %}

Injection -> Curly[ %ws:? TypeExpr %ws:? %bar Many[Assignment, %comma] ] 	{% P.Injection %}
		   | Curly[ %ws:? %bar Many[Assignment, %comma] ] 				{% P.Injection %}

# Tagged
Tagged -> %colon Identifier %ws:? TypeExpr 	{% P.tagged %}

# ------------------------------------
# Blocks
# ------------------------------------
Block -> Curly[ Many[Statement, %semicolon] %semicolon Return:? ] 		{% P.Block %}
	   | Curly[ Return ] 												{% P.Block %}

Statement -> Ann 			{% P.Expr %}
           | Letdec			{% id %}

Return    -> %NL:? %ws:? "return" %ws:+ Ann %semicolon 					{% P.Return %}

Letdec -> "let" %ws Identifier %NL:? %ws:? %equals %NL:? %ws:? Ann 										{% P.LetDec %}
		| "let" %ws Identifier %NL:? %ws:? %colon %ws:? TypeExpr %NL:? %ws:? %equals %ws:? TypeExpr 	{% P.LetDec %}


# VARIABLES
Identifier -> %variable {% P.Name %}

# Multiplicity
Quantity -> "1" {% () => Q.One %}
		  | "0" {% () => Q.Zero %}
		  | "*" {% () => Q.Many %}

# ------------------------------------
# Pattern Matching
# ------------------------------------
Match -> "match" %ws:+ TypeExpr Alt:+ 								{% P.Match %} 
Alt -> %NL:? %ws:? %bar %ws:? Pattern %ws:? %arrow %ws:? TypeExpr 	{% P.Alternative %}


Pattern -> PatKeyVal RowTail:?				{% P.Pattern.Variant %}
		 | PatAtom 								{% id %}

PatAtom -> Identifier 									{% P.Pattern.Var %}
		 | Literal 										{% P.Pattern.Lit %}
		 | Curly[ Many[PatAtom, %comma] RowTail:? ] 	{% P.Pattern.Tuple %}
		 | Curly[ Many[PatKeyVal, %comma] RowTail:? ] 	{% P.Pattern.Struct %}
		 | Square[ Many[PatAtom, %comma] ] RowTail:?	{% P.Pattern.List %}
		 | Square[ Many[PatKeyVal, %comma] RowTail:? ] 	{% P.Pattern.Row %}
		 | Wildcard 									{% P.Pattern.Wildcard %}
		 | Parens[Pattern] 								{% P.extract %}

PatKeyVal -> Identifier %ws:? %colon %ws:? Pattern 		{% P.keyvalPat %}

Wildcard -> %hole 										{% P.Wildcard %}

# ------------------------------------
# Literals
# ------------------------------------
Literal 
	-> String {% P.Str %}
	 | Number {% P.Num %}
	 | "Type" {% P.Type %}
	 | "Unit" {% P.Unit("type") %}
	 | "*" 	  {% P.Unit("value") %}
	 | "Row"  {% P.LitRow %}
	  
Number 
	-> Int %dot Int {% id %}
	 | Int			{% id %}

Int -> %digit  		{% P.sourceLoc %}
String -> %string 	{% P.sourceLoc %}
