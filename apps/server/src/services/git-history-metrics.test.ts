import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gitHistoryMetrics } from "./git-history-metrics.js";

describe("Git repository statistics", () => {
 it("reports current files without fabricating Git history for a ZIP directory", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-metrics-"));
  try {
   await mkdir(path.join(root,"src"));
   await writeFile(path.join(root,"src","alpha.ts"),"const a=1;\nconst b=2;\n");
   await writeFile(path.join(root,"src","short.ts"),"export {};\n");
   await writeFile(path.join(root,"README.md"),"# Hello\nDocs\n");
   await writeFile(path.join(root,"meta.json"),'{"enabled":true}\n');
   const result=await gitHistoryMetrics(root);
   expect(result.available).toBe(false);
   expect(result.wordsAdded).toBeNull();
   expect(result.newFiles).toBeNull();
   expect(result.largestFile).toEqual({path:"src/alpha.ts",lines:2});
   expect(result.smallestCodeFile).toEqual({path:"src/short.ts",lines:1});
   expect(result.markdownLines).toBe(2);
   expect(result.jsonFiles).toBe(1);
   expect(result.directories).toBe(1);
  } finally {await rm(root,{recursive:true,force:true});}
 });
});
