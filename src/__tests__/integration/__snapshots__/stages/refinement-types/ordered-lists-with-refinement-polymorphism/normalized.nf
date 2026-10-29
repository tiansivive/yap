## OrderedList (let)
OrderedList

## ascending (let)
Struct
  [ __tag: cons,
    payload: Struct
      [ head: 1,
        tail: Struct
          [ __tag: cons,
            payload: Struct
              [ head: 2,
                tail: Struct
                  [ __tag: cons,
                    payload: Struct
                      [ head: 3,
                        tail: Struct [ __tag: nil, payload: unit ] ] ] ] ] ] ]

## descending (let)
Struct
  [ __tag: cons,
    payload: Struct
      [ head: 3,
        tail: Struct
          [ __tag: cons,
            payload: Struct
              [ head: 2,
                tail: Struct
                  [ __tag: cons,
                    payload: Struct
                      [ head: 1,
                        tail: Struct [ __tag: nil, payload: unit ] ] ] ] ] ] ]
