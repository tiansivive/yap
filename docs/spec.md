# Yap: A Small Dependently Typed Core (Formal Specification)

This document formalizes the core of Yap as implemented in this repository: a dependently typed language with structural rows (records, variants, tuples, lists), implicit arguments, and verification via Liquid-style refinements (as modal annotations). Multiplicity/usage annotations appear in the syntax but are not enforced here.

The presentation uses standard PLT notation (judgments, rules, and grammars) typeset in LaTeX within Markdown.

## Syntax

We separate identifiers, primitives, literals, rows, values, and general terms. Types are terms inhabiting `Type`.

### Lexical categories

- Identifiers: $x,y,f,r,\ell$ range over variables and labels.
- Quantities: $q \in \{0,1,\omega\}$, written as `0`, `1`, `*`.
- Primitive atoms (grouped as `Primitive`):
  - $\mathrm{APrim} ::= \mathsf{Type} \mid \mathsf{Row} \mid \mathsf{Num} \mid \mathsf{Bool} \mid \mathsf{String} \mid \mathsf{Unit}$
- Primitive literals:
  - $L ::= n \mid \mathsf{true} \mid \mathsf{false} \mid \texttt{"s"} \mid *$ where $n\in \mathbb{Z}$.

### Row shapes (type-level)

- Row variables: $r, r'$
- Row expressions $\rho$:
  $$
  \rho \;::=\; [\,] \mid [\, \ell : A \mid \rho\,] \mid [\, \ell : A \mid r\,]
  $$
  with the side condition that labels are distinct in a row.

### Values (call-by-value)

$$
\begin{array}{lcl}
 v &::=& x \mid L \mid \lambda x.\,t \mid \lambda\{x\}.\,t \\
   && \mid\; \{\, \ell_1 : v_1,\dots, \ell_k : v_k \,\} \mid \{\, \ell_1 : v_1,\dots, \ell_k : v_k \mid r \,\} \\
   && \mid\; \{\, v_1,\dots, v_k \,\} \mid [\, v_1,\dots, v_k \,] \mid [\, v_1,\dots, v_k \mid r \,] \\
   && \mid\; \#\ell\; v
\end{array}
$$

### Terms and types

Let $A,B$ range over terms intended as types. Multiplicity annotations use a modal constructor $\langle q\rangle$. Refinements attach boolean predicates.

$$
\begin{array}{lcl}
 t,u,A,B &::=& x \mid \mathrm{APrim} \mid L \mid (t : A) \\
   && \mid\; \Pi(x : \langle q\rangle A).\,B \mid \Pi\{x : \langle q\rangle A\}.\,B \\
   && \mid\; \lambda x.\,t \mid \lambda\{x\}.\,t \mid t\;u \mid t\;\{u\} \\
   && \mid\; \langle q\rangle A \mid A\;[[\,\lambda x.\,\varphi\,]] \mid \langle q\rangle A\;[[\,\lambda x.\,\varphi\,]] \\
   && \mid\; [\, \ell_1 : A_1,\dots, \ell_k : A_k \mid r \,] \\
   && \mid\; \{\, \ell_1 : t_1,\dots, \ell_k : t_k \mid r \,\} \mid \{\, t_1,\dots, t_k \mid r \,\} \mid [\, t_1,\dots, t_k \mid r \,] \\
   && \mid\; t.\ell \mid .\ell \\
   && \mid\; \mid\, \#\ell_1\, A_1 \mid \cdots \mid \#\ell_k\, A_k \\
   && \mid\; \#\ell\; t \\
   && \mid\; \mathsf{match}\; t\;\mid\; \#\ell_1\, x_1 \to u_1 \mid \cdots \mid \#\ell_k\, x_k \to u_k \\
   && \mid\; \{\, s_1;\;\cdots;\; s_n;\; \mathsf{return}\; t \,\}
\end{array}
$$

Statements: $s ::= t \mid \mathsf{let}\; x = t \mid \mathsf{let}\; x : A = t \mid \mathsf{using}\; t\;[\mathsf{as}\; x] \mid \mathsf{foreign}\; f : A$.

### Primitive operators (Σ)

We assume a fixed signature $\Sigma$ of primitive constants with types:

$$
\begin{aligned}
& +,-,*,/,\% : \mathsf{Num} \to \mathsf{Num} \to \mathsf{Num} \\
& \&\&,\; || : \mathsf{Bool} \to \mathsf{Bool} \to \mathsf{Bool}\qquad ! : \mathsf{Bool} \to \mathsf{Bool} \\
& ==,\; !=,\; <,\; >,\; \le,\; \ge : \mathsf{Num} \to \mathsf{Num} \to \mathsf{Bool}
\end{aligned}
$$

## Typing

Judgment: $\Gamma\;;\;\Delta \vdash t : A$ where $\Gamma$ maps variables to types and $\Delta$ is the implicit environment (multiset of witnesses with types).

We write substitution $B[u/x]$ and definitional equality $A \equiv B$ (NbE). A standard conversion rule applies.

### Structural and base rules

- Variables:
  $$\dfrac{x:A\in\Gamma}{\Gamma\;;\;\Delta\vdash x:A}\;(\text{Var})$$

- Annotation:
  $$\dfrac{\Gamma\;;\;\Delta\vdash t:A\qquad \Gamma\;;\;\Delta\vdash A: \mathsf{Type}}{\Gamma\;;\;\Delta\vdash (t:A):A}\;(\text{Ann})$$

- Conversion:
  $$\dfrac{\Gamma\;;\;\Delta\vdash t:A\qquad \Gamma\;;\;\Delta\vdash A\equiv B: \mathsf{Type}}{\Gamma\;;\;\Delta\vdash t:B}\;(\text{Conv})$$

- Universes and primitives:
  $$\Gamma\;;\;\Delta\vdash \mathsf{Type}:\mathsf{Type}\qquad \Gamma\;;\;\Delta\vdash \mathsf{Num},\mathsf{Bool},\mathsf{String},\mathsf{Unit},\mathsf{Row}:\mathsf{Type}$$
  $$\Gamma\;;\;\Delta\vdash n:\mathsf{Num}\quad \Gamma\;;\;\Delta\vdash \mathsf{true}/\mathsf{false}:\mathsf{Bool}\quad \Gamma\;;\;\Delta\vdash \texttt{"s"}:\mathsf{String}\quad \Gamma\;;\;\Delta\vdash *:\mathsf{Unit}$$

### Modalities and refinements (formation)

$$
\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}}{\Gamma\;;\;\Delta\vdash \langle q\rangle A:\mathsf{Type}}\;(\text{Usage-Form})\qquad
\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}\quad \Gamma,x:A\;;\;\Delta\vdash \varphi:\mathsf{Bool}}{\Gamma\;;\;\Delta\vdash A[[\lambda x.\,\varphi]]:\mathsf{Type}}\;(\text{Refine-Form})
$$

Likewise for $\langle q\rangle A[[\lambda x.\,\varphi]]$.

### Functions and application

We use explicit and implicit Pis with multiplicity on the domain via $\langle q\rangle$.

$$
\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}\quad \Gamma,x:A\;;\;\Delta\vdash B:\mathsf{Type}}{\Gamma\;;\;\Delta\vdash \Pi(x:\langle q\rangle A).\,B:\mathsf{Type}}\;(\Pi\text{-}\to)\qquad
\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}\quad \Gamma,x:A\;;\;\Delta\vdash B:\mathsf{Type}}{\Gamma\;;\;\Delta\vdash \Pi\{x:\langle q\rangle A\}.\,B:\mathsf{Type}}\;(\Pi\text{-}\Rightarrow)
$$

$$
\dfrac{\Gamma,x:A\;;\;\Delta\vdash t:B}{\Gamma\;;\;\Delta\vdash \lambda x.\,t : \Pi(x:\langle q\rangle A).\,B}\;(\lambda\text{-}\to)\qquad
\dfrac{\Gamma,x:A\;;\;\Delta\vdash t:B}{\Gamma\;;\;\Delta\vdash \lambda\{x\}.\,t : \Pi\{x:\langle q\rangle A\}.\,B}\;(\lambda\text{-}\Rightarrow)
$$

$$\dfrac{\Gamma\;;\;\Delta\vdash f: \Pi(x:\langle q\rangle A).\,B\quad \Gamma\;;\;\Delta\vdash u:A}{\Gamma\;;\;\Delta\vdash f\;u : B[u/x]}\;(\text{App-}\to)$$

$$\dfrac{\Gamma\;;\;\Delta\vdash f: \Pi\{x:\langle q\rangle A\}.\,B\quad \Gamma\;;\;\Delta\vdash u:A}{\Gamma\;;\;\Delta\vdash f\;\{u\} : B[u/x]}\;(\text{App-}\Rightarrow\text{-explicit})$$

Implicit resolution:
$$\dfrac{\Gamma\;;\;\Delta\vdash f: \Pi\{x:\langle q\rangle A\}.\,B\quad \exists v\in\Delta.~\Gamma\;;\;\Delta\vdash v:A}{\Gamma\;;\;\Delta\vdash f : B[v/x]}\;(\text{App-}\Rightarrow\text{-res})$$

### Rows and structural terms

Row kinding:

$$
\dfrac{}{\Gamma\;;\;\Delta\vdash [\,]:\mathsf{Row}}\;(\text{Row-Empty})\qquad
\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}\quad \Gamma\;;\;\Delta\vdash \rho:\mathsf{Row}\quad \ell\notin\mathrm{labels}(\rho)}{\Gamma\;;\;\Delta\vdash [\,\ell:A\mid \rho\,]:\mathsf{Row}}\;(\text{Row-Ext})
$$

Record type from a row: $\{\,\rho\,\}:\mathsf{Type}$.

Structs and projection:

$$
\dfrac{}{\Gamma\;;\;\Delta\vdash \{\,\}:\{[\,]\}}\;(\text{Struct-Empty})\qquad
\dfrac{\Gamma\;;\;\Delta\vdash t:A\quad \Gamma\;;\;\Delta\vdash \{\,\rho\,\}:\mathsf{Type}\quad \ell\notin\mathrm{labels}(\rho)}{\Gamma\;;\;\Delta\vdash \{\,\ell:t\mid \rho\,\}:\{\,[\,\ell:A\mid \rho\,] \}}\;(\text{Struct-Ext})
$$

$$\dfrac{\Gamma\;;\;\Delta\vdash s:\{\,[\,\ell:A\mid \rho\,] \}}{\Gamma\;;\;\Delta\vdash s.\ell : A}\;(\text{Proj})$$

Tuples and lists can be encoded via rows (omitted: standard positional labels $1,\dots,k$ for tuples; list literals typed uniformly).

### Variants, tags, and match

Variant formation and introduction:
$$\dfrac{\forall i.~\Gamma\;;\;\Delta\vdash A_i:\mathsf{Type}\quad \ell_i\;\text{distinct}}{\Gamma\;;\;\Delta\vdash \mid\, \#\ell_1 A_1 \mid \cdots \mid \#\ell_k A_k : \mathsf{Type}}\;(\text{Var-Form})$$
$$\dfrac{\Gamma\;;\;\Delta\vdash t:A_i\quad V\equiv \mid\, \#\ell_1 A_1 \mid \cdots \mid \#\ell_k A_k\quad \ell=\ell_i}{\Gamma\;;\;\Delta\vdash \#\ell\; t : V}\;(\text{Tag-Intro})$$

Elimination:
$$\dfrac{\Gamma\;;\;\Delta\vdash t:V\quad V\equiv \mid\, \#\ell_1 A_1 \mid \cdots \mid \#\ell_k A_k\quad \forall i.~\Gamma,x_i:A_i\;;\;\Delta\vdash u_i:C}{\Gamma\;;\;\Delta\vdash \mathsf{match}\; t\;\mid\;\#\ell_1 x_1\to u_1\mid\cdots\mid\#\ell_k x_k\to u_k : C}\;(\text{Match})$$

### Blocks, let, using, foreign

$$\dfrac{\Gamma\;;\;\Delta\vdash t_1:A\quad \Gamma,x:A\;;\;\Delta\vdash t_2:B}{\Gamma\;;\;\Delta\vdash \{\,\mathsf{let}\;x=t_1;\;\cdots;\;\mathsf{return}\; t_2\,\}:B}\;(\text{Let})$$

$$\dfrac{\Gamma\;;\;\Delta\vdash A:\mathsf{Type}\quad \Gamma\;;\;\Delta\vdash t_1:A\quad \Gamma,x:A\;;\;\Delta\vdash t_2:B}{\Gamma\;;\;\Delta\vdash \{\,\mathsf{let}\;x:A=t_1;\;\cdots;\;\mathsf{return}\; t_2\,\}:B}\;(\text{Let-Ann})$$

$$\dfrac{\Gamma\;;\;\Delta\vdash t:A\quad \Gamma\;;\;\Delta,\,t:A\vdash u:B}{\Gamma\;;\;\Delta\vdash \{\,\mathsf{using}\; t;\;\cdots;\;\mathsf{return}\; u\,\}:B}\;(\text{Using})$$

Foreign declarations bind $f:A$ in $\Gamma$; δ-semantics live in the runtime $\Sigma$.

### Refinements and subtyping

Intro by verification:
$$\dfrac{\Gamma\;;\;\Delta\vdash v:A\quad \Gamma\;;\;\Delta\models \varphi(v)}{\Gamma\;;\;\Delta\vdash v: A[[\lambda x.\,\varphi(x)]]}\;(\text{Refine-Intro})$$

Subtyping:

$$
A[[\lambda x.\,\varphi]]\;\,<:\; A\quad (\text{Refine-Forget})\qquad
\dfrac{\Gamma,x:A\models \varphi(x)\Rightarrow \psi(x)}{A[[\lambda x.\,\varphi]]\;\,<:\; A[[\lambda x.\,\psi]]}\;(\text{Refine-Strengthen})
$$

Modal monotonicity: if $A<:B$ then $\langle q\rangle A[[\varphi]] <: \langle q\rangle B[[\varphi]]$.

A standard subsumption rule applies: if $\Gamma\;;\;\Delta\vdash t:A$ and $A<:B$ then $\Gamma\;;\;\Delta\vdash t:B$.

## Operational Semantics (CBV small-step)

We write $t\;\to\; t'$ and use left-to-right evaluation contexts $E$ (omitted for brevity; standard forms for app, projection, tagged, match, blocks, rows).

β-reduction:
$$ (\lambda x.\,t)\, v \to t[v/x] \qquad (\lambda\{x\}.\,t)\, v \to t[v/x] $$

Projection:
$$ \{\,\dots,\, \ell : v,\, \dots\,\}.\ell \to v $$

Match:
$$ \mathsf{match}\; (\#\ell\, v) \;\mid\; \cdots \mid\; \#\ell\, x \to u \mid\; \cdots \;\to\; u[v/x] $$

Let/block:
$$ \{\,\mathsf{let}\; x=v;\; s;\; \mathsf{return}\; t\,\} \to \{\, s[v/x];\; \mathsf{return}\; t[v/x] \,\} $$

Primitive δ-steps (when arguments are literals of the right type):
$$ (\oplus\; v*1\; v_2) \to \delta*\oplus(v*1,v_2) \quad \text{for } \oplus\in\{+,-,\*,/,\%,\&\&,||,==,!=,<,>,\le,\ge\} $$
$$ !\, v \to \delta*!(v) $$

Congruence: if $t\to t'$ then $E[t] \to E[t']$.

NbE in the implementation yields the same normal forms for closed terms; the small-step here specifies behavior abstractly.

## Verification Semantics

Predicate evaluation:

- $\Gamma\;;\;\Delta\vdash \varphi(v) \Downarrow b$ for $b\in\{\mathsf{true},\mathsf{false}\}$ via evaluation and δ.

VCs and validity:

- When $\varphi(v)$ does not reduce to a literal, translate to an SMT formula $\llbracket\varphi(v)\rrbracket$; require solver validity/satisfiability (as implemented).

Satisfaction relation used above:
$$ \Gamma\;;\;\Delta\models \varphi(v) \quad \text{iff}\quad \Gamma\;;\;\Delta\vdash \varphi(v) \Downarrow \mathsf{true}\;\;\text{or}\;\; \vDash\, \llbracket\varphi(v)\rrbracket. $$

Subtyping VC:

- For $A[[\varphi]] <: A[[\psi]]$, generate $\forall x\!:\!A.\, \varphi(x)\Rightarrow \psi(x)$ and require validity.

Modalities $\langle q\rangle$ are carried but not enforced (usage inference out-of-scope here).

## Definitional Equality (conversion)

$\Gamma\vdash A\equiv B$ holds by $\beta\delta\eta$-conversion (with $\delta$ on closed primitives) as realized via NbE. Typing uses (\textsc{Conv}).

## Primitive Signature (summary)

- Base types: $\mathsf{Num},\mathsf{Bool},\mathsf{String},\mathsf{Unit} : \mathsf{Type}$
- Literals: $n: \mathsf{Num}$, $\mathsf{true}/\mathsf{false}: \mathsf{Bool}$, $\texttt{"s"}: \mathsf{String}$, $*: \mathsf{Unit}$
- Operators: as in $\Sigma$ above with the stated types and $\delta$-semantics.

## Notes on surface constructs

- Rows use $[\, \ell : A \mid r\,]$ at the type level; records use $\{\, \ell : t \mid r\,\}$ at the term level.
- Shorthand projection `.\ell` is equivalent to $(\lambda x.\, x.\ell)$ applied to the ambient subject.
- Tuples $\{\, t_1,\dots, t_k \,\}$ and lists $[\, t_1,\dots, t_k \,]$ are row-backed encodings; precise list/tuple type constructors are conventional and omitted.
- Variants are $\mid\, \#\ell\, A \mid \cdots$; values are $\#\ell\, t$.
- Implicit arguments are supplied from $\Delta$ by (\textsc{App-}$\Rightarrow$\,res); “using” augments $\Delta$.

---

This specification matches the current implementation’s surface syntax and core typing/normalization/verification mechanics while presenting them in standard PLT formal notation.
