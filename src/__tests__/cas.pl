:- use_module(library(clpfd)).

% Define the constraints
% Example: x > 0 and x > 5
satisfiable(X) :-
    X #> 0,             % x > 0
    X #> 5,             % x > 5
    labeling([ff], [X]). % Find values for X using the first-fail heuristic

% Example: x > 0 and x < 5
unsatisfiable(X) :-
    X #> 0,             % x > 0
    X #< 5,             % x < 5
    labeling([ff], [X]). % Find values for X using the first-fail heuristic

% Checking for satisfiability
check_satisfaction :-
    (   satisfiable(X)
    ->  write('Satisfiable: X = '), write(X), nl
    ;   write('Unsatisfiable'), nl
    ).