import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";

export const Terms = () => {
	const mkRow = (...fields: ReadonlyArray<[string, EB.Term]>): EB.Row =>
		fields.reduceRight<EB.Row>((acc, [label, value]) => R.Constructors.Extension(label, value, acc), R.Constructors.Empty());

	const mkSchema = (...fields: ReadonlyArray<[string, EB.Term]>): EB.Term => EB.Constructors.Schema(mkRow(...fields));

	const NumType = EB.Constructors.Var({ type: "Free", name: "Num" });
	const defaultArray = EB.Constructors.Var({ type: "Foreign", name: "defaultArray" });
	const mkArray = (element: EB.Term): EB.Term => EB.Constructors.Indexed(NumType, element, defaultArray);

	const StringType = EB.Constructors.Lit(Lit.Atom("String"));
	const JSONType = EB.Constructors.Lit(Lit.Atom("String"));

	const EdgeType = mkSchema(["source", StringType], ["label", StringType], ["target", StringType]);
	const PatternType = mkSchema(["bind", StringType], ["tag", StringType]);
	const ConstructorType = mkSchema(["bind", StringType], ["tag", StringType], ["payload", JSONType]);
	const LhsType = mkSchema(["nodes", mkArray(PatternType)], ["edges", mkArray(EdgeType)]);
	const RhsType = mkSchema(["nodes", mkArray(ConstructorType)], ["edges", mkArray(EdgeType)]);
	const RuleType = mkSchema(["lhs", LhsType], ["rhs", RhsType]);

	return {
		JSON: JSONType,
		Payload: JSONType,
		Edge: EdgeType,
		Pattern: PatternType,
		Constructor: ConstructorType,
		Rule: RuleType,
	};
};

export const NormalForms = {
	JSON: (): NF.Value => NF.Constructors.Lit(Lit.Atom("String")),
};

export const Elaborated = (): EB.Context["imports"] => {
	const terms = Terms();
	return {
		JSON: [terms.JSON, NF.Type, []],
		Payload: [terms.Payload, NF.Type, []],
		Edge: [terms.Edge, NF.Type, []],
		Pattern: [terms.Pattern, NF.Type, []],
		Constructor: [terms.Constructor, NF.Type, []],
		Rule: [terms.Rule, NF.Type, []],
	};
};
