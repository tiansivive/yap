import "../chunk-ZD7AOCMD.mjs";
import fs from "fs";
import winston from "winston";
const logFilePath = ".logs/elaboration.json.log";
const mkLogger = (filepath = logFilePath, opts = { start: "", end: "" }) => {
  return {
    open: (start = opts.start) => fs.writeFileSync(filepath, start),
    log: (phase, key, obj) => {
      const json = JSON.stringify(obj);
      const msg = phase === "entry" ? `
"${key}": ${json.substring(0, json.length - 1)},` : `
"${key}": ${json} },`;
      fs.appendFileSync(filepath, msg);
    },
    close: (end = opts.end) => fs.appendFileSync(filepath, end)
  };
};
const label = ["Lama"];
const push = (l) => label.push(l);
const pop = () => label.pop();
const peek = () => label[label.length - 1];
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: ".logs/debug.log",
      level: "debug",
      format: winston.format.combine(
        winston.format((info) => {
          const msg = `[${label.join(".")}] ${info.message}`;
          info[Symbol.for("message")] = msg.replace(/\n/g, " ");
          const meta = Object.entries(info).reduce((acc, [key, value]) => {
            if (typeof key !== "symbol" && key !== "message" && key !== "level") {
              return { ...acc, [key]: value };
            }
            return acc;
          }, {});
          info.metadata = meta;
          return info;
        })(),
        winston.format.metadata()
      )
    })
  ]
});
const fmt = winston.format.label({ label: label.join(".") });
export {
  logFilePath,
  logger,
  mkLogger,
  peek,
  pop,
  push
};
//# sourceMappingURL=logging.mjs.map