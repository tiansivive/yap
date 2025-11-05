#!/usr/bin/env node

// Load the debug module and its exports
const debug = require("./bin/debug.js");

// Destructure the exports for easier access
const { incf, inc, Nat, Pos } = debug;

// Evaluate expressions here
console.log("inc(5):", inc(5));
console.log("incf(1):", incf(1));

// You can also access via debug object
console.log("debug.incf(10):", debug.incf(10));

// Export everything so this can be used as a module too
module.exports = debug;
