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
	  	variable: { 
			match: /[a-zA-Z][a-zA-Z0-9]*/, type: moo.keywords({ 
				ret: "return", dec: "let", match: "match", 
				Type: "Type", Unit: "Unit", Row: "Row", 
				module: "module", import: "import", exports: "export", from: "from", as: "as" 
			}) 
		},
	  	dot: /\./,
		equals: /\=(?!>)/,
	  	backslash: /\\/,
	  	arrow: /->/,
		fatArrow: /\=>/,
		op: /[\+\-\*\/]/,
		// ws: /[ \t]+/,
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
		space: { match: /[ \n\t]+/, lineBreaks: true },
		// NL: { match: /\n+/, lineBreaks: true },

	});
%}

# Pass your lexer with @lexer:
@lexer lexer

# Declaration
# Def -> "def" %space Identifier %space %equals %space:? Expr %space:? %semicolon {% d => ({ type: "def", binding: d[2], value: d[6] }) %}

Empty[X, Y] -> $X %space:? $Y 									{% P.none %}
Wrap[X, L, R] -> $L $X %space:? $R 								{% P.unwrap %}

Many[X, Separator] 	-> (%space:? $X %space:? $Separator):* %space:? $X 		{% P.many %}
Prefixed[Prefix, X] -> $Prefix %space:? $X 											{% P.prefix %}
Suffixed[X, Suffix] -> $X %space:? $Suffix 											{% P.suffix %}

Parens[X] -> Wrap[$X, %lparens, %rparens] 		{% P.enclosed %}
Angle[X] -> Wrap[$X, %langle, %rangle] 			{% P.enclosed %}
Curly[X] -> Wrap[$X, %lbrace, %rbrace] 			{% P.enclosed %}
Square[X] -> Wrap[$X, %lbracket, %rbracket] 	{% P.enclosed %}


Module -> %space:? Exports Imports:* %space:+ Script 													{% P.module_ %}

Exports -> "export" %space "*" %semicolon 																{% P.exportAll %}
		 | "export" %space Parens[ Many[Identifier, %comma] ] %semicolon 								{% P.exportSome %}

Imports -> %space:+ "import" %space String %semicolon 													{% P.importAll %}
 		 | %space:+ "import" %space String %space Parens[ Many[ Identifier, %comma ] ] %semicolon 		{% P.importSome %}

Script -> Many[Statement, %semicolon] %semicolon %space:?  		{% P.script %}
		#| Ann 				{% id %}

Ann -> Ann %space:? %colon %space:? TypeExpr 							{% P.Annotation %}
     | Ann %space:? %colon %space:? Angle[Quantity] %space:? TypeExpr 	{% P.Annotation %}
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

App -> App %space Atom 				{% P.Application %}
	 | App %space:? %op %space:? Atom 	{% P.Operation %}
     | Atom 						{% id %}

Atom -> Identifier 		{% P.Var %} 
	  | %hole 			{% P.Hole %}
	  | Literal 		{% P.Lit %}
	  | Struct 			{% id %}
      | Tuple 			{% id %}
	  | Projection 		{% id %}
	  | Injection 		{% id %}
	  | List 			{% id %}
	  | Tagged 			{% id %}
	  | Parens[Ann]  	{% P.extract %}

# ------------------------------------
# RECURSIVE TYPES
# ------------------------------------

Mu -> "μ" %space:? Identifier %space:? %arrow %space:? TypeExpr 		{% P.Mu %}

# ------------------------------------
# FUNCTIONS
# ------------------------------------
Lambda -> %backslash Param %space:? %arrow %space:? TypeExpr 				{% P.Lambda("Explicit") %}
		| %backslash Param %space:? %fatArrow %space:? TypeExpr 			{% P.Lambda("Implicit") %}
		
Param -> Identifier 														{% P.Param %}
	   | Identifier %space:? %colon %space:? TypeExpr 							{% P.Param %}
	   | Identifier %space:? %colon %space:? Angle[Quantity] %space:? TypeExpr 		{% P.Param %}
	   | Parens[Param] 														{% P.extract %}
		 

Pi -> Type %space:? %arrow %space:? PiTail 		{% P.Pi("Explicit") %}
	| Type %space:? %fatArrow %space:? PiTail 	{% P.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Type {% id %}


# ------------------------------------
# ROW TERMS
# ------------------------------------
Row -> Empty[%lbracket, %rbracket] 					{% P.emptyRow %}
	 | Square[ Many[KeyVal, %comma] RowTail:? ] 	{% P.row %}

RowTail -> %space:? %bar %space:? Identifier 				{% d => d[3] %}

# Values
Struct -> Empty[%lbrace, %rbrace] 					{% P.emptyStruct %}
	 	| Curly[ Many[KeyVal, %comma] ] 			{% P.struct %}

Tuple -> Curly[ Many[TypeExpr, %comma] ] 				{% P.tuple %}
List -> Square[ Many[TypeExpr, %comma] ] 				{% P.list %}

# Types
Schema -> Curly[ Many[SchemaPair, %comma] RowTail:? ] 	{% P.schema %}

Variant -> %bar Many[KeyVal, %bar]						{% P.variant %}

# Fields
KeyVal -> Identifier %space:? %colon %space:? TypeExpr 				{% P.keyval %}
SchemaPair -> Identifier %space:? %colon %colon %space:? TypeExpr 	{% P.keyval %}
Assignment -> Identifier %space:? %equals %space:? TypeExpr 			{% P.keyval %}

Projection -> Atom %dot Identifier 									{% P.Projection %}
			| %dot Identifier 										{% P.Projection %}

Injection -> Curly[ %space:? Type %space:? %bar Many[Assignment, %comma] ] 	{% P.Injection %}
		   | Curly[ %space:? %bar Many[Assignment, %comma] ] 				{% P.Injection %}

# Tagged
Tagged -> %hash Identifier %space:? TypeExpr 	{% P.tagged %}

# ------------------------------------
# Blocks
# ------------------------------------
Block -> Curly[ Many[Statement, %semicolon] %semicolon Return:? ] 		{% P.Block %}
	   | Curly[ Return ] 												{% P.Block %}

Statement -> Ann 			{% P.Expr %}
           | Letdec			{% id %}

Return    -> %space:? "return" %space Ann %semicolon 					{% P.Return %}

Letdec -> "let" %space Identifier %space:? %equals %space:? Ann 										{% P.LetDec %}
		| "let" %space Identifier %space:? %colon %space:? TypeExpr %space:? %equals %space:? TypeExpr 	{% P.LetDec %}


# VARIABLES
Identifier -> %variable {% P.Name %}

# Multiplicity
Quantity -> "1" {% () => Q.One %}
		  | "0" {% () => Q.Zero %}
		  | "*" {% () => Q.Many %}

# ------------------------------------
# Pattern Matching
# ------------------------------------
Match -> "match" %space:+ TypeExpr Alt:+ 								{% P.Match %} 
Alt -> %space:? %bar %space:? Pattern %space:? %arrow %space:? TypeExpr 	{% P.Alternative %}


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

PatKeyVal -> Identifier %space:? %colon %space:? Pattern 		{% P.keyvalPat %}

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
