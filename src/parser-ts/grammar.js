/**
 * @file Tree-sitter grammar for Yap language
 * @author Yap Contributors
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'yap',

  conflicts: $ => [
    [$.struct, $.block],
    [$.tuple, $.block],
    [$.variable, $.key],
    [$.modal_type, $.injection],
    [$.row, $.list],
    [$.type_expr, $.pi],
    [$.modal_type],
    [$.variant],
    [$.match],
    [$.list, $.dict],
    [$.pi, $.pi_tail],
    [$.pattern_list, $.pattern_row]
  ],

  extras: $ => [
    /\s/,
    $.comment
  ],

  word: $ => $.identifier,

  rules: {
    // Entry points
    source_file: $ => choice(
      $.module,
      $.script
    ),

    module: $ => seq(
      $.exports,
      repeat($.import),
      $.script
    ),

    script: $ => seq(
      $.statement,
      repeat(seq(';', $.statement)),
      optional(';')
    ),

    // Exports
    exports: $ => choice(
      seq('export', '*', ';'),
      seq('export', '(', commaSep($.identifier), ')', ';')
    ),

    // Imports
    import: $ => choice(
      seq('import', $.string, ';'),
      seq('import', $.string, '(', commaSep($.identifier), ')', ';')
    ),

    // Statements
    statement: $ => choice(
      $.let_declaration,
      $.using_statement,
      $.foreign_declaration,
      $.expr
    ),

    let_declaration: $ => choice(
      seq('let', $.identifier, '=', $.ann),
      seq('let', $.identifier, ':', $.type_expr, '=', $.type_expr)
    ),

    using_statement: $ => seq(
      'using',
      $.ann,
      optional(seq('as', $.identifier))
    ),

    foreign_declaration: $ => seq(
      'foreign',
      $.identifier,
      ':',
      $.type_expr
    ),

    // Annotations
    ann: $ => choice(
      seq($.ann, ':', $.type_expr),
      $.type_expr
    ),

    // Type expressions
    type_expr: $ => choice(
      $.pi,
      $.modal_type
    ),

    modal_type: $ => choice(
      seq('<', $.quantity, '>', $.type),
      seq('<', $.quantity, '>', $.type, '[|', $.lambda, '|]'),
      seq($.type, '[|', $.lambda, '|]'),
      $.type
    ),

    type: $ => choice(
      $.mu,
      $.variant,
      $.dict,
      $.row,
      $.expr
    ),

    mu: $ => seq('μ', $.identifier, '->', $.type_expr),

    // Expressions
    expr: $ => choice(
      $.lambda,
      $.match,
      $.block,
      $.reset,
      $.shift,
      $.resume,
      $.operation
    ),

    // Operations (infix operators)
    operation: $ => choice(
      prec.left(10, seq($.operation, choice('+', '-'), $.application)),
      prec.left(20, seq($.operation, choice('*', '/', '%'), $.application)),
      prec.left(5, seq($.operation, choice('==', '!=', '<=', '>=', '<', '>'), $.application)),
      prec.left(3, seq($.operation, choice('|>', '<|'), $.application)),
      prec.left(8, seq($.operation, choice('<>', '++'), $.application)),
      $.application
    ),

    // Application
    application: $ => choice(
      prec.left(30, seq($.application, $.atom)),  // explicit application
      prec.left(30, seq($.application, '@', $.atom)),  // implicit application
      $.atom
    ),

    // Atoms
    atom: $ => choice(
      $.variable,
      $.hole,
      $.literal,
      $.struct,
      $.tuple,
      $.projection,
      $.injection,
      $.list,
      $.tagged,
      seq('(', $.ann, ')')
    ),

    variable: $ => choice(
      $.identifier,
      $.label
    ),

    hole: $ => '_',

    label: $ => seq(':', $.identifier),

    // Literals
    literal: $ => choice(
      $.string,
      $.number,
      $.boolean,
      'Type',
      'Unit',
      '!',
      'Row'
    ),

    string: $ => /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/,

    number: $ => token(choice(
      seq(/[0-9]+/, '.', /[0-9]+/),
      /[0-9]+/
    )),

    boolean: $ => choice('true', 'false'),

    // Lambda
    lambda: $ => choice(
      seq('\\', repeat1($.param), '->', $.type_expr),
      seq('\\', repeat1($.param), '=>', $.type_expr)
    ),

    param: $ => choice(
      $.identifier,
      seq('(', $.typed_param, ')')
    ),

    typed_param: $ => seq($.identifier, ':', $.type_expr),

    // Pi types
    pi: $ => choice(
      seq($.modal_type, '->', $.pi_tail),
      seq($.modal_type, '=>', $.pi_tail)
    ),

    pi_tail: $ => choice(
      $.pi,
      $.modal_type
    ),

    // Row terms
    row: $ => seq('[', commaSep($.key_value), optional(seq('|', $.identifier)), ']'),

    key_value: $ => seq($.key, ':', $.type_expr),

    key: $ => choice(
      $.identifier,
      /[0-9]+/
    ),

    // Struct
    struct: $ => choice(
      seq('{', '}'),
      seq('{', commaSep($.key_value), optional(seq('|', $.identifier)), '}')
    ),

    // Tuple
    tuple: $ => seq('{', commaSep1($.type_expr), optional(seq('|', $.identifier)), '}'),

    // List
    list: $ => choice(
      seq('[', ']'),
      seq('[', commaSep1($.type_expr), optional(seq('|', $.identifier)), ']')
    ),

    // Variant
    variant: $ => seq('|', sep1($.tagged, '|')),

    // Tagged
    tagged: $ => seq('#', $.identifier, $.type_expr),

    // Dict
    dict: $ => seq('{', '[', $.type_expr, ']', ':', $.type_expr, '}'),

    // Projection
    projection: $ => choice(
      prec.left(40, seq($.atom, '.', $.identifier)),
      seq('.', $.identifier)
    ),

    // Injection
    injection: $ => choice(
      seq('{', $.type, '|', commaSep($.assignment), '}'),
      seq('{', '|', commaSep($.assignment), '}')
    ),

    assignment: $ => seq($.identifier, '=', $.type_expr),

    // Block
    block: $ => choice(
      seq('{', repeat(seq($.statement, ';')), optional($.return_statement), '}'),
      seq('{', $.return_statement, '}')
    ),

    return_statement: $ => seq('return', $.ann, ';'),

    // Pattern matching
    match: $ => seq('match', $.type_expr, repeat1($.alternative)),

    alternative: $ => seq('|', $.pattern, '->', $.type_expr),

    pattern: $ => choice(
      $.pattern_variable,
      $.pattern_literal,
      $.pattern_tagged,
      $.pattern_struct,
      $.pattern_tuple,
      $.pattern_list,
      $.pattern_row,
      $.wildcard,
      seq('(', $.pattern, ')')
    ),

    pattern_variable: $ => $.identifier,

    pattern_literal: $ => $.literal,

    pattern_tagged: $ => seq('#', $.identifier, $.pattern),

    pattern_struct: $ => choice(
      seq('{', '}'),
      seq('{', commaSep($.pattern_key_value), optional(seq('|', $.identifier)), '}')
    ),

    pattern_tuple: $ => seq('{', commaSep1($.pattern), optional(seq('|', $.identifier)), '}'),

    pattern_list: $ => choice(
      seq('[', ']'),
      seq('[', commaSep1($.pattern), optional(seq('|', $.identifier)), ']')
    ),

    pattern_row: $ => seq('[', commaSep($.pattern_key_value), optional(seq('|', $.identifier)), ']'),

    pattern_key_value: $ => seq($.identifier, ':', $.pattern),

    wildcard: $ => '_',

    // Delimited continuations
    reset: $ => seq('reset', $.type_expr),

    shift: $ => seq('shift', $.type_expr),

    resume: $ => seq('resume', $.type_expr),

    // Modalities
    quantity: $ => choice('0', '1', '*'),

    // Identifiers
    identifier: $ => /[a-zA-Z][a-zA-Z0-9]*/,

    comment: $ => token(choice(
      seq('//', /.*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')
    ))
  }
});

/**
 * Creates a rule to match one or more of the rules separated by a separator
 * @param {Rule} rule
 * @param {string} separator
 * @return {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 * @param {Rule} rule
 * @return {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 * @param {Rule} rule
 * @return {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
