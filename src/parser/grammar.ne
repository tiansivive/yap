@preprocessor typescript

@{%
	// Moo lexer documentation is here:
	// https://github.com/no-context/moo

	import moo from "moo";
	import * as Q from "@yap/shared/modalities/multiplicity";
	import * as Lit from "@yap/shared/literals";
	import * as P from "./processors";

	const lexer = moo.compile({
	  	digit: { match: /[0-9]+/, value: s => parseInt(s) },
	  	string: { match: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/, value: s => s.slice(1, -1) },
	  	variable: { 
			match: /[a-zA-Z][a-zA-Z0-9]*/, type: moo.keywords({ 
				ret: "return", dec: "let", match: "match", 
				Type: "Type", Unit: "Unit", Row: "Row", 
				module: "module", import: "import", exports: "export", 
				from: "from", as: "as", using: "using" ,
				foreign: "foreign", loop: "loop", repeat: "repeat",
				if: "if", else: "else", then: "then",
				true: "true", false: "false",
			}) 
		},
	  	dot: /\./,
		equals: /\=(?!>)/,
	  	backslash: /\\/,
	  	arrow: /->/,
		backarrow: /<-/,
		fatArrow: /\=>/,
		op: /[\+\-\*\/\<\>]|(?:==)|(?:!=)|(?:<=)|(?:>=)|(?:\|>)|(?:<\|)/,
		concat: /<>/,
		ldoublebracket: /\[\|/,
		rdoublebracket: /\|\]/,
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

Parens[X] -> Wrap[$X, %lparens, %rparens] 						{% P.enclosed %}
Angle[X] -> Wrap[$X, %langle, %rangle] 							{% P.enclosed %}
DoubleBracket[X] -> Wrap[$X, %ldoublebracket, %rdoublebracket] 	{% P.enclosed %}
Curly[X] -> Wrap[$X, %lbrace, %rbrace] 							{% P.enclosed %}
Square[X] -> Wrap[$X, %lbracket, %rbracket] 					{% P.enclosed %}


Module -> %space:? Exports Imports:* %space:+ Script 													{% P.module_ %}

Exports -> "export" %space "*" %semicolon 																{% P.exportAll %}
		 | "export" %space Parens[ Many[Identifier, %comma] ] %semicolon 								{% P.exportSome %}

Imports -> %space:? "import" %space String %semicolon 													{% P.importAll %}
 		 | %space:? "import" %space String %space Parens[ Many[ Identifier, %comma ] ] %semicolon 		{% P.importSome %}

Script -> Many[Statement, %semicolon] %semicolon %space:?  				{% P.script %}

Ann -> Ann %space:? %colon %space:? ModalExpr 							{% P.Annotation %}
    #  | Ann %space:? %colon %space:? Angle[Quantity] %space:? TypeExpr 	{% P.Annotation %}
	 | TypeExpr 														{% id %}

ModalExpr -> Angle[ Quantity ] %space:? TypeExpr 									{% P.Modal %}
		   | Angle[ Quantity ] %space:? TypeExpr %space:? DoubleBracket[ Lambda ] 	{% P.Modal %}
		   | TypeExpr %space:? DoubleBracket[ Lambda ] 								{% P.Modal %}
		   | TypeExpr 																{% id %}

TypeExpr -> Pi 			{% id %}
		  | Type 		{% id %}

Type -> Mu 				{% id %}
	  | Variant 		{% id %} 
	  | Dict 			{% id %}
	  | Row 			{% id %}	
	  | Expr 			{% id %}

Expr -> Lambda		{% id %}
  	  | Match 		{% id %}
  	  | Block 		{% id %}
	  | App 		{% id %}

App -> App %space Atom 				{% P.Application %}
	 | App %space:? (%op | %concat) %space:? Atom 	{% P.Operation %}
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
		
Param -> Identifier 															{% P.Param %}
	   | Identifier %space:? %colon %space:? ModalExpr 							{% P.Param %}
	#    | Identifier %space:? %colon %space:? Angle[Quantity] %space:? TypeExpr 	{% P.Param %}
	   | Parens[Param] 															{% P.extract %}
		 

Pi -> Type %space:? %arrow %space:? PiTail 		{% P.Pi("Explicit") %}
	| Type %space:? %fatArrow %space:? PiTail 	{% P.Pi("Implicit") %}

PiTail -> Pi {% id %}
		| Type {% id %}


# ------------------------------------
# ROW TERMS
# ------------------------------------
Row -> Square[ Many[KeyVal, %comma] RowTail:? ] 	{% P.row %}

RowTail -> %space:? %bar %space:? Identifier 		{% d => d[3] %}

# Values
Struct -> Empty[%lbrace, %rbrace] 					{% P.emptyStruct %}
	 	| Curly[ Many[KeyVal, %comma] ] 			{% P.struct %}

Tuple -> Curly[ Many[TypeExpr, %comma] ] 				{% P.tuple %}
List -> Empty[%lbracket, %rbracket] 					{% P.emptyList %}
	  | Square[ Many[TypeExpr, %comma] ] 				{% P.list %}

Variant -> %bar Many[Tagged, %bar]						{% P.variant %}

Dict -> Curly[ %space:? Square[ %space:? TypeExpr ] %space:? %colon %space:? TypeExpr ] {% P.dict %}

# Fields
KeyVal -> Identifier %space:? %colon %space:? TypeExpr 				{% P.keyval %}


Projection -> Atom %dot Identifier 									{% P.Projection %}
			| %dot Identifier 										{% P.Projection %}

Injection -> Curly[ %space:? Type %space:? %bar Many[Assignment, %comma] ] 	{% P.Injection %}
		   | Curly[ %space:? %bar Many[Assignment, %comma] ] 				{% P.Injection %}

Assignment -> Identifier %space:? %equals %space:? TypeExpr 		{% P.keyval %}

# Tagged
Tagged -> %hash Identifier %space:? TypeExpr 	{% P.tagged %}

# ------------------------------------
# Blocks
# ------------------------------------
Block -> Curly[ Many[Statement, %semicolon] %semicolon Return:? ] 		{% P.Block %}
	   | Curly[ Return ] 												{% P.Block %}

Statement -> TypeExpr 		{% P.Expr %}
           | Letdec			{% id %}
		   | Using 			{% id %}
		   | Foreign 		{% id %}

Return    -> %space:? "return" %space Ann %semicolon 					{% P.Return %}

Letdec -> "let" %space Identifier %space:? %equals %space:? Ann 											{% P.LetDec %}
		| "let" %space Identifier %space:? %colon %space:? ModalExpr %space:? %equals %space:? TypeExpr 	{% P.LetDec %}

Using -> "using" %space Ann 								{% P.Using %}
	   | "using" %space Ann %space "as" %space Identifier  	{% P.Using %}

Foreign -> "foreign" %space Identifier %space:? %colon %space:? TypeExpr 	{% P.Foreign %}


# ------------------------------------
# Variables
# ------------------------------------
Identifier -> %variable {% P.Name %}
			| %colon %variable {% P.Label %}

# Multiplicity
Quantity -> "1" {% () => Q.One %}
		  | "0" {% () => Q.Zero %}
		  | "*" {% () => Q.Many %}

# ------------------------------------
# Pattern Matching
# ------------------------------------
Match -> "match" %space:+ TypeExpr Alt:+ 									{% P.Match %} 
Alt -> %space:? %bar %space:? Pattern %space:? %arrow %space:? TypeExpr 	{% P.Alternative %}


Pattern -> PatAtom 								{% id %}
# PatKeyVal RowTail:?				{% P.Pattern.Variant %}
		 #| PatAtom 								{% id %}

PatAtom -> Identifier 									{% P.Pattern.Var %}
		 | Literal 										{% P.Pattern.Lit %}
		 | (PatTagged %space %bar %space):* PatTagged 	{% P.Pattern.Variant %}
		 | Empty[ %lbrace, %rbrace ] 						{% P.Pattern.Empty.Struct %}
		 | Curly[ Many[PatAtom, %comma] RowTail:? ] 	{% P.Pattern.Tuple %}
		 | Curly[ Many[PatKeyVal, %comma] RowTail:? ] 	{% P.Pattern.Struct %}
		 | Empty[%lbracket, %rbracket] 					{% P.Pattern.Empty.List %}
		 | Square[ Many[PatAtom, %comma] RowTail:? ] 	{% P.Pattern.List %}
		 | Square[ Many[PatKeyVal, %comma] RowTail:? ] 	{% P.Pattern.Row %}
		 | Wildcard 									{% P.Pattern.Wildcard %}
		 | Parens[Pattern] 								{% P.extract %}

PatTagged -> %hash Identifier %space Pattern 	{% P.taggedPat %}

PatKeyVal -> Identifier %space:? %colon %space:? Pattern 		{% P.keyvalPat %}

Wildcard -> %hole 										{% P.Wildcard %}

# ------------------------------------
# Literals
# ------------------------------------
Literal 
	-> String {% P.Str %}
	 | Number {% P.Num %}
	 | Bool   {% P.Bool %}
	 | "Type" {% P.Type %}
	 | "Unit" {% P.Unit("type") %}
	 | "*" 	  {% P.Unit("value") %}
	 | "Row"  {% P.LitRow %}
	  
Number 
	-> Int %dot Int {% id %}
	 | Int			{% id %}

Int -> %digit  		{% P.sourceLoc %}
String -> %string 	{% P.sourceLoc %}
Bool -> "true"  	{% P.sourceLoc %}
	  | "false" 	{% P.sourceLoc %}
