import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

// The page modules that need a browser (app.js, viewer.js, photo.js …) are not imported by the other
// tests, so a syntax error there would only show as a blank page. Parse every one of them.
test("every page module parses", () => {
  const dir = new URL("../js/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    try { execFileSync(process.execPath, ["--check", new URL(f, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { stdio: "pipe" }); }
    catch (e) { assert.fail(`${f}: ${String(e.stderr).split("\n").slice(0, 4).join(" ")}`); }
  }
});
