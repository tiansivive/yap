# Example index

The files in `effects/`, `errors/` and `gaps/` are modules of top-level declarations that exercise effect handling through refinements over the verifier's state. Captures are not lowered, so they typecheck and verify but do not run: the GRAM and codegen stages report an error. `pnpm vitest run src/__tests__/integration/effect-examples.test.ts` checks the verdicts listed for `effects/` and `errors/`.

## Syntax

```yap
foreign Ask: Effect Unit Num;
```

`foreign E: Effect P R` declares an effect identity. A capture sends a `P` and resumes with an `R`.

```yap
let answer = with Ask: (\p k -> k 42) in capture [Ask] !;
```

`with E: h in body` installs the handler `h : P -> (R -> A) -> A` for `body : A`, and `k` resumes the body with the capture's result. Clauses separated by commas nest with the first outermost. `capture [E] p` requires `E` to be live where it runs: the verifier proves `live st E` at that state, which holds inside a `with` for `E` and fails outside one.

```yap
let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;
```

A function body runs at its caller's state, so a function that captures states the requirement on its parameter and every caller proves it at its own state. Refinements take the state first: `[| \st v -> v > 0 |]` reads only the value, and `[| \st -> positive |]` reuses a predicate over values.

## Verified

| File                                                   | What it demonstrates                                                                            | Verdicts                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------- |
| [handled.yap](effects/handled.yap)                     | A capture directly under its handler                                                            | `answer` valid               |
| [operation.yap](effects/operation.yap)                 | An operation used twice under one handler                                                       | `twice` valid                |
| [nested-handlers.yap](effects/nested-handlers.yap)     | An inner handler for the same identity, with the outer captures still covered                   | `nearest` valid              |
| [multiple-handlers.yap](effects/multiple-handlers.yap) | One `with` installs two identities; `scale (ask !)` needs both                                  | `scaled` valid               |
| [handler-function.yap](effects/handler-function.yap)   | A separately defined function supplies the handler                                              | `doubled` valid              |
| [yield.yap](effects/yield.yap)                         | Captures as statements of a block under the handler                                             | `total` valid                |
| [escaping-closure.yap](effects/escaping-closure.yap)   | A closure built under one handler keeps the requirement in its type and is called under another | `later`, `reinstalled` valid |
| [higher-order.yap](effects/higher-order.yap)           | A function takes an effectful callback and installs its handler                                 | `handled`, `result` valid    |
| [value-predicate.yap](effects/value-predicate.yap)     | State-first refinements, including a predicate over values reused through `\st -> positive`     | `x`, `y` valid               |

## Expected failures

| File                                                        | What it demonstrates                                                      | Verdicts                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| [unhandled.yap](errors/unhandled.yap)                       | A capture with no handler                                                 | `unhandled` invalid            |
| [other-handler.yap](errors/other-handler.yap)               | A handler for a different identity                                        | `other` invalid                |
| [pure-function.yap](errors/pure-function.yap)               | A function captures without stating the requirement, declared or inferred | `declared`, `inferred` invalid |
| [call-without-handler.yap](errors/call-without-handler.yap) | A function that states the requirement, called with no handler            | `outside` invalid              |
| [escaped-closure.yap](errors/escaped-closure.yap)           | The closure from `escaping-closure.yap` called after its handler is gone  | `escaped` invalid              |
| [pure-callback.yap](errors/pure-callback.yap)               | An effectful function passed where `Unit -> Num` is expected              | `result` invalid               |

## Known gaps

| File                                                      | Outcome                      | Cause                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [block-let.yap](gaps/block-let.yap)                       | `unchecked` valid            | A `let` value's obligation sits in guard position, where validity discharge assumes it instead of proving it.                                |
| [rethrow.yap](gaps/rethrow.yap)                           | `rethrown` invalid           | The inner handler captures outward. A handler is a lambda verified at an unknown state, and its elaborated type carries no requirement.      |
| [inferred-arithmetic.yap](gaps/inferred-arithmetic.yap)   | `twice` fails in translation | Without a result annotation the inferred refinement of `+` mentions the captures themselves. `operation.yap` annotates `twice: Num` instead. |
| [polymorphic-identity.yap](gaps/polymorphic-identity.yap) | elaboration error            | `with` does not instantiate a result-polymorphic carrier such as `(a: Type) => Effect String a`.                                             |

The handler, nesting, multiple-handler, handler-function, yield, rethrow, abort and pure-function examples are ported from the effect-identities spike. Its control-operator, evidence and multishot examples have no counterpart here.
