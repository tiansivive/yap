{
  let getName: (r: Row) => { name: String | r } -> String =
    \item -> item.name;
  let person = { name: "Ada", age: 36 };
  let book = { name: "Notes", pages: 42, available: true };
  return { person: getName person, book: getName book };
}
