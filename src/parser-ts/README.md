# Tree-sitter Parser for Yap

This directory contains a tree-sitter implementation of the Yap language parser.

## Overview

Tree-sitter is a parser generator tool and an incremental parsing library. It builds a concrete syntax tree for source files and keeps it up-to-date as the file is edited. This implementation replaces the Nearley-based parser with a more robust and performant tree-sitter parser.

## Structure

- `grammar.js` - The tree-sitter grammar definition for Yap
- `src/` - Generated C parser code
- `bindings/node/` - Node.js bindings for the parser
- `processor.ts` - Converts tree-sitter parse trees to Yap AST (src/parser/terms.ts)
- `index.ts` - Main entry point

## Building

The parser needs to be built before it can be used:

```bash
cd src/parser-ts
npm install
npx tree-sitter generate
```

This will generate the C parser code and build the Node.js bindings.

## Usage

```typescript
import { parse } from "@yap/parser-ts";

const sourceCode = `let x = 42`;
const ast = parse(sourceCode);
// ast matches the format defined in src/parser/terms.ts
```

## Grammar

The grammar is defined in `grammar.js` and covers:

- **Literals**: strings, numbers, booleans, Type, Unit, Row
- **Variables**: identifiers and labels
- **Functions**: lambda expressions and pi types (dependent functions)
- **Application**: explicit and implicit function application
- **Row types**: structs, tuples, lists, variants, dictionaries
- **Blocks**: statement sequences with optional return
- **Pattern matching**: match expressions with alternatives
- **Modalities**: quantity annotations and liquid refinements
- **Delimited continuations**: reset, shift, resume
- **Module system**: imports and exports

## AST Compatibility

The processor (`processor.ts`) converts tree-sitter's parse tree into the AST format defined in `src/parser/terms.ts`. The goal is to maintain compatibility with the existing elaboration pipeline with minimal changes.

### Known Deviations

The tree-sitter AST is structurally equivalent to the Nearley AST, with the following considerations:

1. **Location information**: Tree-sitter provides more precise location information (row/column based) which is converted to the Yap location format
2. **Error handling**: Tree-sitter provides better error recovery and can continue parsing after errors
3. **Performance**: Tree-sitter is significantly faster, especially for large files and incremental parsing

## Grammar Conflicts

Tree-sitter requires explicit conflict resolution for ambiguous grammars. The following conflicts are declared:

- `struct` vs `block` - Both use `{}`
- `variable` vs `key` - Identifiers in different contexts
- `modal_type` vs `injection` - Type annotations vs row injections
- `row` vs `list` - Empty `[]` syntax
- `type_expr` vs `pi` - Arrow type parsing
- `variant` - Variant alternatives with `|`
- `match` - Match alternatives
- `list` vs `dict` - Dictionary syntax
- `pi` vs `pi_tail` - Nested pi types
- `pattern_list` vs `pattern_row` - Pattern matching ambiguity

These conflicts are resolved through precedence and GLR parsing.

## Testing

Currently, tests are deferred to a later phase. The focus is on generating a working parser that produces compatible AST output.

## Future Work

- Add comprehensive tests
- Optimize grammar for better error messages
- Add syntax highlighting queries
- Add code folding queries
- Add indentation queries
