import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
test("Windows one-click wizard never transmits or deletes owner key material",async()=>{
 const bat=await readFile(path.join(root,"AKARIYA-KEYS.bat"),"utf8");
 assert.match(bat,/scripts\\import-publisher-key\.mjs/);
 assert.match(bat,/scripts\\bootstrap-node\.ps1/);
 assert.match(bat,/\.runtime\\node\\node\.exe/);
 assert.doesNotMatch(bat,/publisher-private\.pem"\s*>/i);
 assert.doesNotMatch(bat,/\bdel\b|\berase\b|Remove-Item|git\s+add/i);
 assert.match(bat,/call :custom_folder/);
});
