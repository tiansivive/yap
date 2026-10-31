{
  let Pair: Type -> Type -> Type = \a b -> { first: a, second: b };
  let Maybe: Type -> Type = \a -> | #nothing Unit | #just a;
  let pair: Pair Num String = { first: 42, second: "answer" };
  let present: Maybe Num = #just (pair.first);
  let absent: Maybe String = #nothing !;
  return { pair: pair, present: present, absent: absent };
}
