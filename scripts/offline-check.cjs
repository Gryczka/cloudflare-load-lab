// Preload for local checks: never open credential files or inherit provider tokens.
const fs = require("node:fs");
const promises = require("node:fs/promises");
const { fileURLToPath } = require("node:url");
for (const key of Object.keys(process.env))
  if (/TOKEN|API_KEY|SECRET|PASSWORD/i.test(key)) delete process.env[key];
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
process.env.WRANGLER_SEND_METRICS = "false";
function blocked(path) {
  const value = path instanceof URL ? fileURLToPath(path) : String(path);
  return (
    /(?:^|[/\\])(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|secrets(?:\..*)?|wrangler\.local\.jsonc|session\.json)$/.test(
      value,
    ) || /[/\\]\.wrangler[/\\]config[/\\]/.test(value)
  );
}
function missing(path) {
  return Object.assign(
    new Error("Credential file unavailable to offline checks"),
    { code: "ENOENT", path: String(path) },
  );
}
for (const name of ["readFileSync", "openSync", "statSync", "lstatSync"]) {
  const original = fs[name];
  fs[name] = function (path, ...args) {
    if (blocked(path)) throw missing(path);
    return original.call(this, path, ...args);
  };
}
const exists = fs.existsSync;
fs.existsSync = (path) => !blocked(path) && exists(path);
for (const name of ["readFile", "open", "stat", "lstat", "access"]) {
  const original = promises[name];
  promises[name] = async function (path, ...args) {
    if (blocked(path)) throw missing(path);
    return original.call(this, path, ...args);
  };
  const callback = fs[name];
  fs[name] = function (path, ...args) {
    if (blocked(path)) {
      const done = args.at(-1);
      if (typeof done === "function")
        return queueMicrotask(() => done(missing(path)));
      throw missing(path);
    }
    return callback.call(this, path, ...args);
  };
}
require("node:module").syncBuiltinESMExports();
