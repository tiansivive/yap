import "../chunk-ZD7AOCMD.mjs";
const LITERAL = {
  Num: (value) => ({ type: "Num", value }),
  Bool: (value) => ({ type: "Bool", value }),
  String: (value) => ({ type: "String", value }),
  unit: () => ({ type: "unit" }),
  Unit: () => ({ type: "Atom", value: "Unit" }),
  Type: () => ({ type: "Atom", value: "Type" }),
  Row: () => ({ type: "Atom", value: "Row" }),
  Atom: (value) => ({ type: "Atom", value })
};
const { Num, Bool, String, Unit, unit, Type, Row, Atom } = LITERAL;
const display = (lit) => {
  switch (lit.type) {
    case "String":
      return `"${lit.value}"`;
    case "Num":
      return `${lit.value}`;
    case "Bool":
      return `${lit.value}`;
    case "unit":
      return `${lit.type}`;
    case "Atom":
      return lit.value;
  }
};
export {
  Atom,
  Bool,
  Num,
  Row,
  String,
  Type,
  Unit,
  display,
  unit
};
//# sourceMappingURL=literals.mjs.map