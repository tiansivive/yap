# Example: Delimited Continuations with shift/reset

# Simple example: shift captures the continuation
# reset (\k v -> ...) term
# The handler receives the continuation k and the shifted value v

# Example 1: Basic shift/reset
# This should elaborate and type-check correctly
let example1 = reset \k v -> v 42

# Example 2: Using the continuation
# The continuation k represents "what comes after" the shift
let example2 = reset \k v -> k v shift 10

# Example 3: Multiple parameters in handler
# Handler can take both continuation and value
let example3 = reset \k v -> k (v + 1) shift 5

# Note: Actual evaluation of delimited continuations is in progress
# This file demonstrates the syntax and type checking
