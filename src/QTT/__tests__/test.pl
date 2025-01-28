

relation(1,2,3).
relation(1,3,2).
relation(2,3,1).
relation(2,1,3).
relation(3,1,2).
relation(3,2,1).

collect_relations(A, List) :-
    findall([X, Y], relation(A, X, Y), List).


struct([0, foo], "foo").
struct([0, bar], "bar").
struct([1, baz], "baz").

% Query by index list
query_struct(IndexList, Result) :-
    findall(Value, struct(IndexList, Value), Result).

% Query by partial index list (only values)
query_struct_partial(PartialIndexList, Result) :-
    findall(Value, (struct(IndexList, Value), sublist(PartialIndexList, IndexList)), Result).

% Query by partial index list (index list and values)
query_struct_partial_with_index(PartialIndexList, Result) :-
    findall([IndexList, Value], (struct(IndexList, Value), sublist(PartialIndexList, IndexList)), Result).

% Helper predicate to check if one list is a sublist of another
sublist(SubL, L) :-
    append(_, L2, L),
    append(SubL, _, L2).