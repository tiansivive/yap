# Runnable examples

The files in `language/`, `effects/` and `errors/` are standalone expressions. Paste a file into Pipeline Explorer with the expression entry point, or run it through the elaborator and CEK interpreter:

```sh
pnpm exec ts-node --transpile-only scripts/effects-spike.ts examples/language/functions.yap
pnpm exec ts-node --transpile-only scripts/effects-spike.ts examples/effects/raw-named.yap --core
```

The runner accepts both language and effect examples. `--core` prints the elaborated term before the result.

**Compiled** means CEK, GRAM/MIR interpretation and generated JavaScript produce the listed result. **Interpreter** means CEK produces the result; the current compiler reports a gap. Verification is a separate Explorer stage, and some of these examples still produce verification diagnostics.

## Language

| File | What it demonstrates | Expected result | Execution |
| --- | --- | --- | --- |
| [functions.yap](language/functions.yap) | Inferred polymorphism, composition and partial application | `{ number: 42, text: "hello", flag: true }` | Interpreter |
| [records.yap](language/records.yap) | `$field` references, projection, field replacement and extension | `{ area: 42, point: { x: 42, y: 20, z: 30 } }` | Compiled |
| [row-polymorphism.yap](language/row-polymorphism.yap) | One projection function accepts records with different extra fields | `{ person: "Ada", book: "Notes" }` | Compiled |
| [variants.yap](language/variants.yap) | Tagged alternatives and a fallback value | `{ present: 42, absent: 7 }` | Interpreter |
| [recursion.yap](language/recursion.yap) | Recursive factorial and an accumulator loop | `{ factorial: 120, sum: 55 }` | Interpreter |
| [implicit-dictionaries.yap](language/implicit-dictionaries.yap) | A record interface supplied through `using` | `{ equal: true, different: false }` | Interpreter |
| [dependent-fields.yap](language/dependent-fields.yap) | Singleton field dependencies with `&first`, plus a refinement | `{ same: { first: 7, second: 7 }, next: { first: 7, second: 8 } }` | Compiled |
| [type-constructors.yap](language/type-constructors.yap) | Functions over types construct pairs and optional values | `{ pair: { first: 42, second: "answer" }, present: #just 42, absent: #nothing ! }` | Compiled |

The interpreter examples retain useful compiler reproducers: composition reaches an unbound intermediate value, recursive lets reach an unbound function reference, and dictionaries/variant matching expose type names at runtime.

## Effects and control

All examples in this table have been checked through CEK, GRAM, MIR and JavaScript.

| File | What it demonstrates | Expected result |
| --- | --- | --- |
| [raw-control0.yap](effects/raw-control0.yap) | Bare `k` leaves the inner delimiter removed; a later capture reaches the outer reset | `999` |
| [raw-shift0.yap](effects/raw-shift0.yap) | `reset (k v)` gives the resumed body a delimiter | `2099` |
| [raw-named.yap](effects/raw-named.yap) | A named raw reset whose declared payload is an inline-handler function | `12` |
| [handler-delimiters.yap](effects/handler-delimiters.yap) | Placing a reset around the handler body changes which delimiter its capture reaches | `{ outside: 100, inside: 1100 }` |
| [abort.yap](effects/abort.yap) | A result-polymorphic failure operation returns directly from its handler | `0` |
| [multiple-handlers.yap](effects/multiple-handlers.yap) | Two clauses handle separate identities in one expression | `42` |
| [nested-handlers.yap](effects/nested-handlers.yap) | The nearest handler answers; the outer handler becomes active again afterward | `40` |
| [rethrow.yap](effects/rethrow.yap) | An inner handler transforms a payload and captures the same identity outward | `111` |
| [multishot.yap](effects/multishot.yap) | The handler runs its continuation twice and adds the results | `23` |
| [handler-function.yap](effects/handler-function.yap) | A separately defined handler factory supplies the handler | `42` |
| [handler-evaluated-once.yap](effects/handler-evaluated-once.yap) | An effectful handler expression runs once while its handler processes two operations | `42` |
| [evidence-record.yap](effects/evidence-record.yap) | A function captures through an explicitly passed record of evidence | `42` |
| [using-evidence.yap](effects/using-evidence.yap) | A capability record supplies an ordinary operation's implicit evidence | `42` |

Start with `raw-control0.yap` and `raw-shift0.yap` together: the extra reset around `k 1` changes the second capture's target. `handler-delimiters.yap` demonstrates the other placement, around the handler body. `raw-named.yap` makes the identity and payload protocol explicit.

The earlier examples provide additional starting points:

| File | What it demonstrates | Expected result |
| --- | --- | --- |
| [control.yap](effects/control.yap) | `control0`, `shift0`, `control` and `shift` packaged in a record | `11` |
| [control-functions.yap](effects/control-functions.yap) | The same four operators as local functions | `11` |
| [handlers.yap](effects/handlers.yap) | A separately defined operation used twice | `42` |
| [await.yap](effects/await.yap) | A parametric handler evaluates synchronous thunk payloads | `42` |
| [yield.yap](effects/yield.yap) | A handler adds yielded values to the resumed answer | `3` |
| [probe1.yap](effects/probe1.yap) | Another capture in a deeply resumed computation | `1099` |
| [probe2.yap](effects/probe2.yap) | A capture from the handler reaches the enclosing delimiter | `100` |
| [probe3.yap](effects/probe3.yap) | A delayed closure resumes captured control later | `1099` |

## Expected errors

These files demonstrate elaboration checks. The expected outcome is the diagnostic described here.

| File | Expected check |
| --- | --- |
| [raw-reset-payload.yap](errors/raw-reset-payload.yap) | Raw reset requires an inline-handler payload; `Ask` declares `Unit` as its operation payload. |
| [pure-function.yap](errors/pure-function.yap) | `ask` requires effect evidence, while its declared `Unit -> Num` type is pure. |
| [escaping-local-effect.yap](errors/escaping-local-effect.yap) | The returned function requires the locally introduced identity `Local`. |

## Module examples

[effects/local-compiled.yap](effects/local-compiled.yap) is a module exporting `result = 12`:

```sh
pnpm yap examples/effects/local-compiled.yap --srcDir . -o /tmp/yap-effects-output
```

[try-me.yap](try-me.yap) and [chess.yap](chess.yap) are the larger existing language/FFI playgrounds, with companion JavaScript files.
