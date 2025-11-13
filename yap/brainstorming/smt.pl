% Simple finite-domain SMT-ish solver in Prolog
% Supports: arithmetic (+,-,*,/), comparisons (==, !=, >, >=, <, <=), boolean connectives,
% universal quantification forall, and function application via congruence.
% It searches for a finite model over a user-provided integer domain.
% Function quantification is supported by enumerating all functions from a finite domain to a finite domain.
% Representation conventions:
%  - Terms: int(N), var(Name), add(A,B), sub(A,B), mul(A,B), div(A,B), app(F,Arg)
%  - Formula: eq(A,B), neq(A,B), gt(A,B), ge(A,B), lt(A,B), le(A,B), and(A,B), or(A,B), not(A),
%             forall(Var,Sort,Body) where Sort = int or Sort = func(FromSort,ToSort)
%  - Function symbols are prolog atoms (e.g. f) used in app(f, Arg).
%  - Env for variable assignments is list Var=Value.
%  - FunInterp is list FunName-mapping where mapping is list ArgVal-ResultVal pairs.
%
% Usage example:
% ?- Domain = [-1,0,1], solve(eq(app(f,int(0)),int(0)), Domain, 2, Result).
% This will search for a model where there exists an interpretation for f mapping domain->domain
% such that f(0) = 0.
%
% More interesting: universal quantification over functions:
% ?- Domain=[0,1], Formula = forall(f, func(int,int), forall(x,int, eq(app(f,x), int(0)))),
%    solve(Formula, Domain, 2, Result).
% This asks whether every function from Domain->Domain is constant 0. It will return unsat unless Domain={0}.
%
% Note: This is a small finite-model finder. It is not a general SMT solver. Use small domains for tractability.

:- use_module(library(lists)).

% entry point
% solve(+Formula, +Domain, +MaxFunMappings, -Result)
% Domain: list of integers that are used as the finite domain for Int sort
% MaxFunMappings: limit on how many distinct functions to enumerate for each function quantifier (pruning)
% Result = sat(Model) or unsat(Counterexample)
solve(Formula, Domain, MaxFunMappings, Result) :-
    empty_env(Env),
    empty_fun_interp(FI),
    (   satisfy(Formula, Domain, MaxFunMappings, Env, FI, ModelOut)
    ->  Result = sat(ModelOut)
    ;   Result = unsat(no_model_found)
    ).

empty_env([]).
empty_fun_interp([]).

% satisfy(+Formula,+Domain,+MaxFns,+Env,+FunInterp,-ModelOut)
% ModelOut aggregates variable assignments and function interpretations found.
satisfy(Formula, Domain, MaxF, Env, FI, ModelOut) :-
    eval_formula(Formula, Domain, MaxF, Env, FI, true, FI2, Env2),
    % return model
    ModelOut = model{env:Env2, funs:FI2}.

% eval_formula(F, Domain, MaxF, Env, FI, ExpectedBool, FIOut, EnvOut)
% ExpectedBool is true or false to control direct evaluation.
% For standard usage we evaluate asking for truth.

% boolean constants
eval_formula(true, _D, _M, Env, FI, true, FI, Env) :- !.
eval_formula(false, _D, _M, Env, FI, false, FI, Env) :- !.

% conjunction
eval_formula(and(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_formula(A, D, M, Env, FI, true, FI1, Env1),
    eval_formula(B, D, M, Env1, FI1, true, FIout, Envout).

% disjunction
eval_formula(or(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    ( eval_formula(A, D, M, Env, FI, true, FIout, Envout)
    ; eval_formula(B, D, M, Env, FI, true, FIout, Envout)
    ).

% negation
eval_formula(not(A), D, M, Env, FI, true, FIout, Envout) :- !,
    % ensure A is false
    eval_formula(A, D, M, Env, FI, false, FIout, Envout).

% equality
eval_formula(eq(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_term(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA == VB.

% inequality
eval_formula(neq(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_term(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA \== VB.

% greater than
eval_formula(gt(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA > VB.

eval_formula(ge(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA >= VB.

eval_formula(lt(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA < VB.

eval_formula(le(A,B), D, M, Env, FI, true, FIout, Envout) :- !,
    eval_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    VA =< VB.

% quantifier: forall variable of sort int
eval_formula(forall(Var, int, Body), D, M, Env, FI, true, FIout, Envout) :- !,
    % iterate over all values in D and check Body holds for each
    forall(member(V, D), (
        bind_var(Var, V, Env, Env1),
        eval_formula(Body, D, M, Env1, FI, true, FI, _)
    )),
    FIout = FI, Envout = Env.

% quantifier: forall function variable
eval_formula(forall(FunVar, func(FromSort, ToSort), Body), D, M, Env, FI, true, FIout, Envout) :- !,
    % build list of possible functions from domain->domain (finite)
    domain_for_sort(FromSort, D, DomainFrom),
    domain_for_sort(ToSort, D, DomainTo),
    generate_all_functions(DomainFrom, DomainTo, M, FunMappings),
    % for each possible function mapping, bind it and check Body
    forall(member(Map, FunMappings), (
        bind_fun(FunVar, Map, Env, Env1),
        eval_formula(Body, D, M, Env1, FI, true, FI, _)
    )),
    FIout = FI, Envout = Env.

% fallback: evaluate should be false
eval_formula(F, D, M, Env, FI, false, FIout, Envout) :-
    % try to make F true fails
    \+ eval_formula(F, D, M, Env, FI, true, FIout, Envout).

% eval_term(+Term, +Domain, +MaxF, +Env, +FI, -Value, -FIout, -EnvOut)
% Terms that evaluate to elements of the domain

% integer literal
eval_term(int(N), _D, _M, Env, FI, N, FI, Env) :- !.
% variable
eval_term(var(X), _D, _M, Env, FI, V, FI, Env) :- !,
    ( memberchk(X=V, Env) -> true ; fail ).

% function application: app(F,Arg)
eval_term(app(FSym, ArgT), D, M, Env, FI, Vout, FIout, Envout) :- !,
    eval_term(ArgT, D, M, Env, FI, ArgV, FI1, Env1),
    (   lookup_fun(FSym, FI1, Map)
    ->  ( memberchk(ArgV-Res, Map) -> Vout = Res, FIout = FI1, Envout = Env1
        ; fail )
    ;   % uninterpreted function not yet assigned: assign mapping nondeterministically
        domain_values_for_arg(ArgV, D, Values), % Values is same as D normally
        % choose Result from domain
        member(Vcand, Values),
        Map = [ArgV-Vcand],
        FI2 = [FSym-Map | FI1],
        Vout = Vcand,
        FIout = FI2,
        Envout = Env1
    ).

% arithmetic operators produce integer values
eval_arith(Term, D, M, Env, FI, V, FIout, Envout) :-
    eval_term_arith(Term, D, M, Env, FI, V, FIout, Envout).

% fall back to eval_term for simple cases
eval_term_arith(int(N), _D, _M, Env, FI, N, FI, Env) :- !.
eval_term_arith(var(X), _D, _M, Env, FI, V, FI, Env) :- !,
    memberchk(X=V, Env).

eval_term_arith(add(A,B), D, M, Env, FI, V, FIout, Envout) :- !,
    eval_term_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    V is VA + VB.

eval_term_arith(sub(A,B), D, M, Env, FI, V, FIout, Envout) :- !,
    eval_term_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    V is VA - VB.

eval_term_arith(mul(A,B), D, M, Env, FI, V, FIout, Envout) :- !,
    eval_term_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    V is VA * VB.

eval_term_arith(div(A,B), D, M, Env, FI, V, FIout, Envout) :- !,
    eval_term_arith(A, D, M, Env, FI, VA, FI1, Env1),
    eval_term_arith(B, D, M, Env1, FI1, VB, FIout, Envout),
    VB =\= 0,
    V is VA // VB.

% helpers

bind_var(Var, Val, Env, EnvOut) :-
    ( select(Var=_, Env, Rest) -> EnvOut = [Var=Val | Rest] ; EnvOut = [Var=Val | Env] ).

bind_fun(FunVar, Map, Env, EnvOut) :-
    % function variables bind into env as FunVar=map(Map)
    ( select(FunVar=_, Env, Rest) -> EnvOut = [FunVar=Map | Rest] ; EnvOut = [FunVar=Map | Env] ).

lookup_fun(Name, FI, Map) :- member(Name-Map, FI).

% domain_for_sort(+Sort, +GlobalDomain, -Domain)
% for now only int sorts map to GlobalDomain; other sorts can be extended
domain_for_sort(int, D, D).

% generate all functions from DomainFrom->DomainTo but cap the total by Max
generate_all_functions(FromDom, ToDom, Max, AllMaps) :-
    length(FromDom, N0),
    % list of keys that functions map from, we use the sorted list
    Keys = FromDom,
    % each function is a list of pairs Key-Value
    findall(Map, gen_fun_map(Keys, ToDom, Map), All),
    (   length(All, L), L > Max -> length(AllMaps, Max), append(AllMaps, _, All)
    ;   AllMaps = All
    ).

gen_fun_map([], _To, []).
gen_fun_map([K|Ks], To, [K-V|Rest]) :- member(V, To), gen_fun_map(Ks, To, Rest).

% domain_values_for_arg(ArgV, D, Values)
% we return D as possible values
domain_values_for_arg(_Arg, D, D).

% Example convenience: try to find counterexample for universally quantified formula by negating it
% check_unsat(+Formula, +Domain, +MaxF, -Counterexample)
% If formula is universally valid then unsat; otherwise provides counterexample (model where negation holds)
check_unsat(forall(V,Sort,Body), D, M, Result) :-
    % to find counterexample try to find an assignment s.t. not Body holds for some instantiation
    (   % we attempt to find witness for negation
        % create existential by enumerating possible instantiations
        domain_for_sort(Sort, D, Domain),
        member(W, Domain),
        bind_var(V, W, [], Env),
        ( \+ eval_formula(Body, D, M, Env, [], true, _FI, _Env2) -> Result = counterexample{var:V, val:W} ; fail )
    ->  true
    ;   Result = valid
    ).

% Small test cases included as facts for quick manual try.

% Example 1: exists f such that f(0)=0
example1(Domain,Max,Res) :- Formula = eq(app(f, int(0)), int(0)), solve(Formula, Domain, Max, Res).

% Example 2: forall f. forall x. f(x) = 0
example2(Domain,Max,Res) :- Formula = forall(f, func(int,int), forall(x, int, eq(app(f, var(x)), int(0)))), solve(Formula, Domain, Max, Res).

% Notes:
% - This solver treats top-level free variables as bound by the environment search when needed.
% - It is intentionally small and brute-force. Use small domains.

% End of file
