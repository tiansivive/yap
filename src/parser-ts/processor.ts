/**
 * Tree-sitter AST to Yap Terms converter
 * This module converts tree-sitter parse trees into the AST format defined in src/parser/terms.ts
 */

import Parser from "tree-sitter";
import type { Term, Variable, Statement, Row, Pattern, Alternative, Module, Script, Import, Export } from "../parser/terms";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import { Literal } from "@yap/shared/literals";
import * as L from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";
import * as P from "@yap/shared/provenance";

type SyntaxNode = Parser.SyntaxNode;

/**
 * Convert source location from tree-sitter to Yap location format
 */
function toLocation(node: SyntaxNode): P.Location {
  return {
    from: {
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    },
    to: {
      line: node.endPosition.row + 1,
      column: node.endPosition.column + 1,
    },
  };
}

/**
 * Main converter class
 */
export class TreeSitterToYap {
  constructor(private sourceCode: string) {}

  /**
   * Convert a tree-sitter parse tree to Module or Script
   */
  convert(tree: Parser.Tree): Module | Script {
    const rootNode = tree.rootNode;
    
    if (rootNode.type === "source_file") {
      const firstChild = rootNode.firstChild;
      if (firstChild && firstChild.type === "module") {
        return this.processModule(firstChild);
      } else if (firstChild && firstChild.type === "script") {
        return this.processScript(firstChild);
      }
    }
    
    throw new Error(`Unexpected root node type: ${rootNode.type}`);
  }

  private processModule(node: SyntaxNode): Module {
    const children = node.children;
    let exports: Export | undefined;
    const imports: Import[] = [];
    let script: Script | undefined;

    for (const child of children) {
      switch (child.type) {
        case "exports":
          exports = this.processExports(child);
          break;
        case "import":
          imports.push(this.processImport(child));
          break;
        case "script":
          script = this.processScript(child);
          break;
      }
    }

    if (!exports || !script) {
      throw new Error("Module must have exports and script");
    }

    return {
      type: "module",
      imports,
      exports,
      content: script,
    };
  }

  private processExports(node: SyntaxNode): Export {
    const children = node.children;
    
    // Check for "export *"
    if (children.some(c => c.type === "*")) {
      return { type: "*" };
    }

    // Otherwise, it's explicit exports
    const names: string[] = [];
    for (const child of children) {
      if (child.type === "identifier") {
        names.push(child.text);
      }
    }

    return { type: "explicit", names };
  }

  private processImport(node: SyntaxNode): Import {
    const children = node.children;
    let filepath: string | undefined;
    const names: string[] = [];

    for (const child of children) {
      if (child.type === "string") {
        filepath = this.processStringLiteral(child);
      } else if (child.type === "identifier") {
        names.push(child.text);
      }
    }

    if (!filepath) {
      throw new Error("Import must have filepath");
    }

    if (names.length === 0) {
      return { type: "*", filepath, hiding: [] };
    }

    return { type: "explicit", filepath, names };
  }

  private processScript(node: SyntaxNode): Script {
    const statements: Statement[] = [];
    
    for (const child of node.children) {
      if (child.type === "statement") {
        statements.push(this.processStatement(child));
      }
    }

    return { type: "script", script: statements };
  }

  private processStatement(node: SyntaxNode): Statement {
    const child = node.firstChild;
    if (!child) {
      throw new Error("Statement must have a child");
    }

    const location = toLocation(node);

    switch (child.type) {
      case "let_declaration":
        return this.processLetDeclaration(child, location);
      case "using_statement":
        return this.processUsingStatement(child, location);
      case "foreign_declaration":
        return this.processForeignDeclaration(child, location);
      default:
        // Expression statement
        return {
          type: "expression",
          value: this.processTerm(child),
          location,
        };
    }
  }

  private processLetDeclaration(node: SyntaxNode, location: P.Location): Statement {
    const children = node.children;
    let identifier: string | undefined;
    let value: Term | undefined;
    let annotation: Term | undefined;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === "identifier" && !identifier) {
        identifier = child.text;
      } else if (child.type === "=" || child.text === "=") {
        // Next child is the value
        if (i + 1 < children.length) {
          const nextChild = children[i + 1];
          if (nextChild.type === "type_expr" || this.isTermNode(nextChild)) {
            value = this.processTerm(nextChild);
          }
        }
      } else if (child.type === ":" || child.text === ":") {
        // Next child is the annotation
        if (i + 1 < children.length) {
          const nextChild = children[i + 1];
          if (nextChild.type === "type_expr" || this.isTermNode(nextChild)) {
            annotation = this.processTerm(nextChild);
          }
        }
      } else if (child.type === "ann" && !value) {
        value = this.processTerm(child);
      }
    }

    if (!identifier || !value) {
      throw new Error("Let declaration must have identifier and value");
    }

    return {
      type: "let",
      variable: identifier,
      value,
      annotation,
      location,
    };
  }

  private processUsingStatement(node: SyntaxNode, location: P.Location): Statement {
    const children = node.children;
    let value: Term | undefined;

    for (const child of children) {
      if (child.type === "ann" || this.isTermNode(child)) {
        value = this.processTerm(child);
        break;
      }
    }

    if (!value) {
      throw new Error("Using statement must have a value");
    }

    return {
      type: "using",
      value,
      location,
    };
  }

  private processForeignDeclaration(node: SyntaxNode, location: P.Location): Statement {
    const children = node.children;
    let identifier: string | undefined;
    let annotation: Term | undefined;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === "identifier") {
        identifier = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        annotation = this.processTerm(child);
      }
    }

    if (!identifier || !annotation) {
      throw new Error("Foreign declaration must have identifier and annotation");
    }

    return {
      type: "foreign",
      variable: identifier,
      annotation,
      location,
    };
  }

  /**
   * Main term processor - dispatches to specific handlers
   */
  processTerm(node: SyntaxNode): Term {
    const location = toLocation(node);

    switch (node.type) {
      case "ann":
      case "type_expr":
      case "modal_type":
      case "type":
      case "expr":
        // Unwrap wrapper nodes
        return node.firstChild ? this.processTerm(node.firstChild) : this.processAtom(node);
      
      case "annotation":
        return this.processAnnotation(node, location);
      
      case "lambda":
        return this.processLambda(node, location);
      
      case "pi":
        return this.processPi(node, location);
      
      case "application":
        return this.processApplication(node, location);
      
      case "operation":
        return this.processOperation(node, location);
      
      case "atom":
        return node.firstChild ? this.processTerm(node.firstChild) : this.processAtom(node);
      
      case "variable":
        return this.processVariable(node, location);
      
      case "hole":
        return { type: "hole", location };
      
      case "literal":
        return this.processLiteral(node, location);
      
      case "struct":
        return this.processStruct(node, location);
      
      case "tuple":
        return this.processTuple(node, location);
      
      case "list":
        return this.processList(node, location);
      
      case "row":
        return this.processRow(node, location);
      
      case "variant":
        return this.processVariant(node, location);
      
      case "dict":
        return this.processDict(node, location);
      
      case "tagged":
        return this.processTagged(node, location);
      
      case "projection":
        return this.processProjection(node, location);
      
      case "injection":
        return this.processInjection(node, location);
      
      case "block":
        return this.processBlock(node, location);
      
      case "match":
        return this.processMatch(node, location);
      
      case "reset":
        return this.processReset(node, location);
      
      case "shift":
        return this.processShift(node, location);
      
      case "resume":
        return this.processResume(node, location);
      
      case "mu":
        return this.processMu(node, location);
      
      default:
        // Try to process children
        if (node.childCount > 0) {
          return this.processTerm(node.firstChild!);
        }
        throw new Error(`Unsupported node type: ${node.type} at ${location.from.line}:${location.from.column}`);
    }
  }

  private processAnnotation(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let term: Term | undefined;
    let ann: Term | undefined;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === ":" || child.text === ":") {
        // Before colon is term, after is annotation
        if (i > 0) {
          term = this.processTerm(children[i - 1]);
        }
        if (i + 1 < children.length) {
          ann = this.processTerm(children[i + 1]);
        }
        break;
      }
    }

    if (!term || !ann) {
      throw new Error("Annotation must have term and type");
    }

    return { type: "annotation", term, ann, location };
  }

  private processLambda(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const params: Array<{ variable: string; annotation?: Term }> = [];
    let body: Term | undefined;
    let icit: Implicitness = "Explicit";

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === "param") {
        const param = this.processParam(child);
        params.push(param);
      } else if (child.type === "=>" || child.text === "=>") {
        icit = "Implicit";
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        body = this.processTerm(child);
      }
    }

    if (params.length === 0 || !body) {
      throw new Error("Lambda must have at least one parameter and a body");
    }

    // Build nested lambdas from right to left
    return params.reduceRight((acc, param) => ({
      type: "lambda" as const,
      icit,
      variable: param.variable,
      annotation: param.annotation,
      body: acc,
      location,
    }), body);
  }

  private processParam(node: SyntaxNode): { variable: string; annotation?: Term } {
    const children = node.children;
    
    for (const child of children) {
      if (child.type === "identifier") {
        return { variable: child.text };
      } else if (child.type === "typed_param") {
        return this.processTypedParam(child);
      }
    }

    throw new Error("Param must have identifier or typed_param");
  }

  private processTypedParam(node: SyntaxNode): { variable: string; annotation?: Term } {
    const children = node.children;
    let variable: string | undefined;
    let annotation: Term | undefined;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === "identifier") {
        variable = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        annotation = this.processTerm(child);
      }
    }

    if (!variable) {
      throw new Error("Typed param must have variable");
    }

    return { variable, annotation };
  }

  private processPi(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let lhs: Term | undefined;
    let rhs: Term | undefined;
    let icit: Implicitness = "Explicit";

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      if (child.type === "modal_type" || this.isTermNode(child)) {
        if (!lhs) {
          lhs = this.processTerm(child);
        } else {
          rhs = this.processTerm(child);
        }
      } else if (child.type === "pi_tail") {
        rhs = this.processTerm(child);
      } else if (child.type === "=>" || child.text === "=>") {
        icit = "Implicit";
      }
    }

    if (!lhs || !rhs) {
      throw new Error("Pi must have lhs and rhs");
    }

    // Check if lhs is an annotation with a variable
    if (lhs.type === "annotation" && lhs.term.type === "var") {
      return {
        type: "pi",
        icit,
        variable: lhs.term.variable.value,
        annotation: lhs.ann,
        body: rhs,
        location,
      };
    }

    // Otherwise, it's an arrow type
    return {
      type: "arrow",
      lhs,
      rhs,
      icit,
      location,
    };
  }

  private processApplication(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let fn: Term | undefined;
    let arg: Term | undefined;
    let icit: Implicitness = "Explicit";

    for (const child of children) {
      if (child.type === "@" || child.text === "@") {
        icit = "Implicit";
      } else if (this.isTermNode(child)) {
        if (!fn) {
          fn = this.processTerm(child);
        } else {
          arg = this.processTerm(child);
        }
      }
    }

    if (!fn || !arg) {
      throw new Error("Application must have function and argument");
    }

    return {
      type: "application",
      fn,
      arg,
      icit,
      location,
    };
  }

  private processOperation(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let lhs: Term | undefined;
    let rhs: Term | undefined;
    let op: string | undefined;

    for (const child of children) {
      if (this.isTermNode(child)) {
        if (!lhs) {
          lhs = this.processTerm(child);
        } else {
          rhs = this.processTerm(child);
        }
      } else if (this.isOperator(child.text)) {
        op = child.text;
      }
    }

    if (!lhs || !rhs || !op) {
      throw new Error("Operation must have lhs, rhs, and operator");
    }

    // Convert infix operator to function application
    const opVar: Variable = {
      type: "name",
      value: op,
      location: toLocation(node),
    };

    const opTerm: Term = {
      type: "var",
      variable: opVar,
      location: toLocation(node),
    };

    const app1: Term = {
      type: "application",
      fn: opTerm,
      arg: lhs,
      icit: "Explicit",
      location,
    };

    return {
      type: "application",
      fn: app1,
      arg: rhs,
      icit: "Explicit",
      location,
    };
  }

  private processVariable(node: SyntaxNode, location: P.Location): Term {
    const child = node.firstChild;
    
    if (child?.type === "label") {
      const labelText = child.text.substring(1); // Remove leading ':'
      const variable: Variable = {
        type: "label",
        value: labelText,
        location,
      };
      return { type: "var", variable, location };
    }

    const variable: Variable = {
      type: "name",
      value: node.text,
      location,
    };
    
    return { type: "var", variable, location };
  }

  private processLiteral(node: SyntaxNode, location: P.Location): Term {
    const child = node.firstChild;
    if (!child) {
      throw new Error("Literal must have a child");
    }

    let literal: Literal;

    switch (child.type) {
      case "string":
        literal = { type: "String", value: this.processStringLiteral(child) };
        break;
      
      case "number":
        literal = { type: "Num", value: parseFloat(child.text) };
        break;
      
      case "boolean":
        literal = { type: "Bool", value: child.text === "true" };
        break;
      
      case "Type":
        literal = L.Type();
        break;
      
      case "Unit":
        literal = L.Unit();
        break;
      
      case "!":
        literal = L.unit();
        break;
      
      case "Row":
        literal = L.Row();
        break;
      
      default:
        throw new Error(`Unsupported literal type: ${child.type}`);
    }

    return { type: "lit", value: literal, location };
  }

  private processStringLiteral(node: SyntaxNode): string {
    const text = node.text;
    // Remove quotes and unescape
    return JSON.parse(text);
  }

  private processStruct(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const pairs: Array<[string, Term]> = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "key_value") {
        const [key, value] = this.processKeyValue(child);
        pairs.push([key, value]);
      } else if (child.type === "|" || child.text === "|") {
        // Next child is the tail variable
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    const row = this.buildRow(pairs, tail, location);

    return {
      type: "struct",
      row,
      tail,
      location,
    };
  }

  private processTuple(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const elements: Term[] = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        elements.push(this.processTerm(child));
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    // Convert to indexed row
    const pairs: Array<[string, Term]> = elements.map((term, idx) => [idx.toString(), term]);
    const row = this.buildRow(pairs, tail, location);

    return {
      type: "tuple",
      row,
      location,
    };
  }

  private processList(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const elements: Term[] = [];
    let rest: Variable | undefined;

    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        elements.push(this.processTerm(child));
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          rest = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    return {
      type: "list",
      elements,
      rest,
      location,
    };
  }

  private processRow(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const pairs: Array<[string, Term]> = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "key_value") {
        const [key, value] = this.processKeyValue(child);
        pairs.push([key, value]);
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    const row = this.buildRow(pairs, tail, location);

    return {
      type: "row",
      row,
      location,
    };
  }

  private processVariant(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const pairs: Array<[string, Term]> = [];

    for (const child of children) {
      if (child.type === "tagged") {
        const [tag, term] = this.processTaggedForVariant(child);
        pairs.push([tag, term]);
      }
    }

    const row = this.buildRow(pairs, undefined, location);

    return {
      type: "variant",
      row,
      location,
    };
  }

  private processDict(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let index: Term | undefined;
    let term: Term | undefined;

    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        if (!index) {
          index = this.processTerm(child);
        } else {
          term = this.processTerm(child);
        }
      }
    }

    if (!index || !term) {
      throw new Error("Dict must have index and term");
    }

    return {
      type: "dict",
      index,
      term,
      location,
    };
  }

  private processTagged(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let tag: string | undefined;
    let term: Term | undefined;

    for (const child of children) {
      if (child.type === "identifier") {
        tag = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        term = this.processTerm(child);
      }
    }

    if (!tag || !term) {
      throw new Error("Tagged must have tag and term");
    }

    return {
      type: "tagged",
      tag,
      term,
      location,
    };
  }

  private processTaggedForVariant(node: SyntaxNode): [string, Term] {
    const children = node.children;
    let tag: string | undefined;
    let term: Term | undefined;

    for (const child of children) {
      if (child.type === "identifier") {
        tag = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        term = this.processTerm(child);
      }
    }

    if (!tag || !term) {
      throw new Error("Tagged must have tag and term");
    }

    return [tag, term];
  }

  private processProjection(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let term: Term | undefined;
    let label: string | undefined;

    for (const child of children) {
      if (child.type === "atom" || this.isTermNode(child)) {
        term = this.processTerm(child);
      } else if (child.type === "identifier") {
        label = child.text;
      }
    }

    if (!label) {
      throw new Error("Projection must have label");
    }

    // If no term, it's a partial projection
    if (!term) {
      term = { type: "hole", location };
    }

    return {
      type: "projection",
      label,
      term,
      location,
    };
  }

  private processInjection(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let term: Term | undefined;
    let label: string | undefined;
    let value: Term | undefined;

    for (const child of children) {
      if (child.type === "type" || (this.isTermNode(child) && !value)) {
        term = this.processTerm(child);
      } else if (child.type === "assignment") {
        const [l, v] = this.processAssignment(child);
        label = l;
        value = v;
      }
    }

    if (!label || !value) {
      throw new Error("Injection must have label and value");
    }

    if (!term) {
      term = { type: "hole", location };
    }

    return {
      type: "injection",
      label,
      value,
      term,
      location,
    };
  }

  private processBlock(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    const statements: Statement[] = [];
    let returnTerm: Term | undefined;

    for (const child of children) {
      if (child.type === "statement") {
        statements.push(this.processStatement(child));
      } else if (child.type === "return_statement") {
        returnTerm = this.processReturnStatement(child);
      }
    }

    return {
      type: "block",
      statements,
      return: returnTerm,
      location,
    };
  }

  private processReturnStatement(node: SyntaxNode): Term {
    const children = node.children;
    
    for (const child of children) {
      if (child.type === "ann" || this.isTermNode(child)) {
        return this.processTerm(child);
      }
    }

    throw new Error("Return statement must have a term");
  }

  private processMatch(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let scrutinee: Term | undefined;
    const alternatives: Alternative[] = [];

    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        if (!scrutinee) {
          scrutinee = this.processTerm(child);
        }
      } else if (child.type === "alternative") {
        alternatives.push(this.processAlternative(child));
      }
    }

    if (!scrutinee || alternatives.length === 0) {
      throw new Error("Match must have scrutinee and alternatives");
    }

    return {
      type: "match",
      scrutinee,
      alternatives,
      location,
    };
  }

  private processAlternative(node: SyntaxNode): Alternative {
    const children = node.children;
    let pattern: Pattern | undefined;
    let term: Term | undefined;

    for (const child of children) {
      if (child.type === "pattern" || child.type.startsWith("pattern_")) {
        pattern = this.processPattern(child);
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        term = this.processTerm(child);
      }
    }

    if (!pattern || !term) {
      throw new Error("Alternative must have pattern and term");
    }

    return {
      pattern,
      term,
      location: toLocation(node),
    };
  }

  private processPattern(node: SyntaxNode): Pattern {
    const child = node.firstChild || node;

    switch (child.type) {
      case "pattern_variable":
      case "identifier":
        return {
          type: "var",
          value: {
            type: "name",
            value: child.text,
            location: toLocation(child),
          },
        };
      
      case "pattern_literal":
        return this.processPatternLiteral(child);
      
      case "pattern_struct":
        return this.processPatternStruct(child);
      
      case "pattern_tuple":
        return this.processPatternTuple(child);
      
      case "pattern_list":
        return this.processPatternList(child);
      
      case "pattern_row":
        return this.processPatternRow(child);
      
      case "pattern_tagged":
        return this.processPatternTagged(child);
      
      case "wildcard":
        return { type: "wildcard" };
      
      default:
        if (child.type === "pattern") {
          return this.processPattern(child);
        }
        throw new Error(`Unsupported pattern type: ${child.type}`);
    }
  }

  private processPatternLiteral(node: SyntaxNode): Pattern {
    const child = node.firstChild;
    if (!child) {
      throw new Error("Pattern literal must have a child");
    }

    const literalNode = child.firstChild || child;
    let literal: Literal;

    switch (literalNode.type) {
      case "string":
        literal = { type: "String", value: this.processStringLiteral(literalNode) };
        break;
      
      case "number":
        literal = { type: "Num", value: parseFloat(literalNode.text) };
        break;
      
      case "boolean":
        literal = { type: "Bool", value: literalNode.text === "true" };
        break;
      
      default:
        throw new Error(`Unsupported pattern literal type: ${literalNode.type}`);
    }

    return { type: "lit", value: literal };
  }

  private processPatternStruct(node: SyntaxNode): Pattern {
    const children = node.children;
    const pairs: Array<[string, Pattern]> = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "pattern_key_value") {
        const [key, pattern] = this.processPatternKeyValue(child);
        pairs.push([key, pattern]);
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    const row = this.buildPatternRow(pairs, tail);

    return {
      type: "struct",
      row,
    };
  }

  private processPatternTuple(node: SyntaxNode): Pattern {
    const children = node.children;
    const patterns: Pattern[] = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "pattern" || child.type.startsWith("pattern_")) {
        patterns.push(this.processPattern(child));
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    const pairs: Array<[string, Pattern]> = patterns.map((p, idx) => [idx.toString(), p]);
    const row = this.buildPatternRow(pairs, tail);

    return {
      type: "tuple",
      row,
    };
  }

  private processPatternList(node: SyntaxNode): Pattern {
    const children = node.children;
    const elements: Pattern[] = [];
    let rest: Variable | undefined;

    for (const child of children) {
      if (child.type === "pattern" || child.type.startsWith("pattern_")) {
        elements.push(this.processPattern(child));
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          rest = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    return {
      type: "list",
      elements,
      rest,
    };
  }

  private processPatternRow(node: SyntaxNode): Pattern {
    const children = node.children;
    const pairs: Array<[string, Pattern]> = [];
    let tail: Variable | undefined;

    for (const child of children) {
      if (child.type === "pattern_key_value") {
        const [key, pattern] = this.processPatternKeyValue(child);
        pairs.push([key, pattern]);
      } else if (child.type === "|" || child.text === "|") {
        const nextSibling = child.nextSibling;
        if (nextSibling?.type === "identifier") {
          tail = {
            type: "name",
            value: nextSibling.text,
            location: toLocation(nextSibling),
          };
        }
      }
    }

    const row = this.buildPatternRow(pairs, tail);

    return {
      type: "row",
      row,
    };
  }

  private processPatternTagged(node: SyntaxNode): Pattern {
    const children = node.children;
    const tags: Array<{ tag: string; pattern: Pattern }> = [];

    for (const child of children) {
      if (child.type === "pattern_tagged" || child.type === "#") {
        let tag: string | undefined;
        let pattern: Pattern | undefined;

        for (const grandchild of child.children || [child]) {
          if (grandchild.type === "identifier") {
            tag = grandchild.text;
          } else if (grandchild.type === "pattern" || grandchild.type.startsWith("pattern_")) {
            pattern = this.processPattern(grandchild);
          }
        }

        if (tag && pattern) {
          tags.push({ tag, pattern });
        }
      }
    }

    if (tags.length === 0) {
      throw new Error("Pattern tagged must have at least one tag");
    }

    // Build nested variant patterns
    const pairs: Array<[string, Pattern]> = tags.map(({ tag, pattern }) => [tag, pattern]);
    const row = this.buildPatternRow(pairs, undefined);

    return {
      type: "variant",
      row,
    };
  }

  private processReset(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    
    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        return {
          type: "reset",
          term: this.processTerm(child),
          location,
        };
      }
    }

    throw new Error("Reset must have a term");
  }

  private processShift(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    
    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        return {
          type: "shift",
          term: this.processTerm(child),
          location,
        };
      }
    }

    throw new Error("Shift must have a term");
  }

  private processResume(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    
    for (const child of children) {
      if (child.type === "type_expr" || this.isTermNode(child)) {
        return {
          type: "resume",
          term: this.processTerm(child),
          location,
        };
      }
    }

    throw new Error("Resume must have a term");
  }

  private processMu(node: SyntaxNode, location: P.Location): Term {
    const children = node.children;
    let variable: string | undefined;
    let body: Term | undefined;

    for (const child of children) {
      if (child.type === "identifier") {
        variable = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        body = this.processTerm(child);
      }
    }

    if (!variable || !body) {
      throw new Error("Mu must have variable and body");
    }

    // Mu is represented as a modal term with special semantics
    // For now, we'll represent it as an annotation
    const varTerm: Term = {
      type: "var",
      variable: { type: "name", value: variable, location },
      location,
    };

    return {
      type: "annotation",
      term: varTerm,
      ann: body,
      location,
    };
  }

  private processKeyValue(node: SyntaxNode): [string, Term] {
    const children = node.children;
    let key: string | undefined;
    let value: Term | undefined;

    for (const child of children) {
      if (child.type === "key") {
        key = child.text;
      } else if (child.type === "identifier") {
        key = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        value = this.processTerm(child);
      }
    }

    if (!key || !value) {
      throw new Error("KeyValue must have key and value");
    }

    return [key, value];
  }

  private processPatternKeyValue(node: SyntaxNode): [string, Pattern] {
    const children = node.children;
    let key: string | undefined;
    let pattern: Pattern | undefined;

    for (const child of children) {
      if (child.type === "identifier") {
        if (!key) {
          key = child.text;
        }
      } else if (child.type === "pattern" || child.type.startsWith("pattern_")) {
        pattern = this.processPattern(child);
      }
    }

    if (!key || !pattern) {
      throw new Error("Pattern KeyValue must have key and pattern");
    }

    return [key, pattern];
  }

  private processAssignment(node: SyntaxNode): [string, Term] {
    const children = node.children;
    let label: string | undefined;
    let value: Term | undefined;

    for (const child of children) {
      if (child.type === "identifier") {
        label = child.text;
      } else if (child.type === "type_expr" || this.isTermNode(child)) {
        value = this.processTerm(child);
      }
    }

    if (!label || !value) {
      throw new Error("Assignment must have label and value");
    }

    return [label, value];
  }

  private buildRow(pairs: Array<[string, Term]>, tail: Variable | undefined, location: P.Location): Row {
    let row: R.Row<Term, Variable>;

    if (pairs.length === 0) {
      row = R.Constructors.Empty();
    } else {
      row = pairs.reduceRight((acc, [key, value]) => {
        return R.Constructors.Extension(key, value, acc);
      }, R.Constructors.Empty<Term, Variable>());
    }

    if (tail) {
      row = R.Constructors.Variable(tail);
    }

    return { ...row, location };
  }

  private buildPatternRow(pairs: Array<[string, Pattern]>, tail: Variable | undefined): R.Row<Pattern, Variable> {
    let row: R.Row<Pattern, Variable>;

    if (pairs.length === 0) {
      row = R.Constructors.Empty();
    } else {
      row = pairs.reduceRight((acc, [key, pattern]) => {
        return R.Constructors.Extension(key, pattern, acc);
      }, R.Constructors.Empty<Pattern, Variable>());
    }

    if (tail) {
      row = R.Constructors.Variable(tail);
    }

    return row;
  }

  private processAtom(node: SyntaxNode): Term {
    // Fallback for unrecognized atom types
    const location = toLocation(node);
    
    if (node.text === "_") {
      return { type: "hole", location };
    }

    // Try to parse as variable
    return {
      type: "var",
      variable: {
        type: "name",
        value: node.text,
        location,
      },
      location,
    };
  }

  private isTermNode(node: SyntaxNode): boolean {
    return [
      "ann", "type_expr", "modal_type", "type", "expr",
      "lambda", "pi", "application", "operation", "atom",
      "variable", "literal", "struct", "tuple", "list",
      "row", "variant", "dict", "tagged", "projection",
      "injection", "block", "match", "reset", "shift",
      "resume", "mu", "hole"
    ].includes(node.type);
  }

  private isOperator(text: string): boolean {
    return [
      "+", "-", "*", "/", "%",
      "==", "!=", "<=", ">=", "<", ">",
      "|>", "<|", "<>", "++"
    ].includes(text);
  }
}
