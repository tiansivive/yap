import "./chunk-ZD7AOCMD.mjs";
import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as EB from "@yap/elaboration";
import * as E from "fp-ts/lib/Either";
import * as CG from "./Codegen/terms";
import fs from "fs";
import vm from "vm";
import util from "util";
import { resolve } from "path";
import * as Lib from "@yap/shared/lib/primitives";
import beautify from "js-beautify";
const interpret = (code, ctx, opts = { nf: false }) => {
  const g = Grammar;
  g.ParserStart = "Script";
  const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));
  const sanitized = code.trim().endsWith(";") ? code : `${code};`;
  const data = parser.feed(sanitized);
  if (data.results.length !== 1) {
    console.error("Failed to parse statement");
    fs.writeFileSync(resolve(process.cwd(), "./.logs/error.json"), JSON.stringify(data.results, null, 2));
    throw new Error("Error while parsing statement. Check error.json for more information");
  }
  const { script } = data.results[0];
  if (script.length !== 1) {
    throw new Error("Expected a single statement");
  }
  const [stmt] = script;
  return interpretStmt(stmt, ctx, opts);
};
const letdecs = [];
const interpretStmt = (stmt, ctx, opts = { nf: false }) => {
  if (stmt.type === "let") {
    const [name, result] = EB.Mod.letdec(stmt, ctx);
    if (E.isLeft(result)) {
      console.warn(EB.V2.display(result.left));
      return ctx;
    }
    const [[tm, ty, us], ctx_] = result.right;
    const code = `let ${name} = ${CG.codegen([name], tm)};`;
    letdecs.push(code);
    console.log(`:: ${EB.NF.display(ty, ctx)}`);
    if (opts.nf) {
      const nf = EB.NF.evaluate(ctx, tm);
      console.log(`NF: ${EB.NF.display(nf, ctx)}`);
    }
    console.log(`

${code}`);
    return ctx_;
  }
  if (stmt.type === "expression") {
    const result = EB.Mod.expression(stmt, ctx);
    if (E.isLeft(result)) {
      console.warn(EB.V2.display(result.left));
      return ctx;
    }
    const [tm, ty, us, zonker] = result.right;
    const code = CG.codegen([], tm);
    const script = letdecs.join("\n") + `
${code}`;
    const formatted = beautify.js(script, { indent_size: 2 });
    console.log("\nTranspiled JavaScript:\n");
    console.log(formatted);
    const imported = Object.keys(ctx.imports).reduce((acc, key) => {
      return { ...acc, [key]: key };
    }, {});
    const vmCtx = vm.createContext({ ...imported, ...Lib.FFI });
    const res = vm.runInContext(script, vmCtx);
    const pretty = typeof res === "function" ? beautify.js(res.toString(), { indent_size: 2 }) : util.inspect(res, { showHidden: true, depth: null });
    console.log("\n" + pretty + ` :: ${EB.NF.display(ty, { zonker, metas: ctx.metas, env: ctx.env })}
`);
    if (opts.nf) {
      const nf = EB.NF.evaluate(ctx, tm);
      console.log(`NF: ${EB.NF.display(nf, { zonker, metas: ctx.metas, env: ctx.env })}`);
    }
    return ctx;
  }
  throw new Error("Unsupported statement");
};
export {
  interpret
};
//# sourceMappingURL=interpreter.mjs.map