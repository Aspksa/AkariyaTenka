import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitHistoryMetrics, activityMap, longestStreak } from "./git-history-metrics.js";

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
 it("measures the project rhythm from local Git history", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-rhythm-"));
  const git=(args:string[],date?:string)=>execFileSync("git",["-C",root,...args],{env:{...process.env,
   GIT_AUTHOR_NAME:"Fox",GIT_AUTHOR_EMAIL:"fox@example.invalid",GIT_COMMITTER_NAME:"Fox",GIT_COMMITTER_EMAIL:"fox@example.invalid",
   ...(date?{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}:{})}});
  try {
   git(["init","-q"]);
   await writeFile(path.join(root,"a.ts"),"export const a=1;\n");
   git(["add","."]);git(["commit","-qm","first"],"2024-03-04T10:00:00");
   await writeFile(path.join(root,"a.ts"),"export const a=2;\n");
   git(["commit","-qam","second"],"2024-03-05T10:00:00");
   const result=await gitHistoryMetrics(root);
   expect(result.commits).toBe(2);
   expect(result.authors).toBe(1);
   expect(result.activeDays).toBe(2);
   expect(result.longestStreak).toBe(2);
   expect(result.hours?.reduce((a,b)=>a+b,0)).toBe(2);
   expect(result.weekdays?.reduce((a,b)=>a+b,0)).toBe(2);
   expect(result.activity).toHaveLength(activityMap([]).length);
  } finally {await rm(root,{recursive:true,force:true});}
 });
});

describe("activity helpers", () => {
 it("builds 26 weeks of days starting on a Monday and counts commits per day", () => {
  const now=new Date(2026,9,14,15,0,0);
  const at=(d:Date)=>Math.floor(d.getTime()/1000);
  const days=activityMap([at(new Date(2026,9,14,9)),at(new Date(2026,9,14,11)),at(new Date(2026,9,13,9))],now);
  expect(new Date(days[0]!.date+"T12:00:00").getDay()).toBe(1);
  expect(days.at(-1)).toEqual({date:"2026-10-14",commits:2});
  expect(days.at(-2)).toEqual({date:"2026-10-13",commits:1});
  expect(days.length).toBeGreaterThan(25*7);
  expect(days.length).toBeLessThanOrEqual(26*7);
 });
 it("finds the longest run of consecutive days", () => {
  const at=(y:number,m:number,d:number)=>Math.floor(new Date(y,m,d,12).getTime()/1000);
  expect(longestStreak([])).toBe(0);
  expect(longestStreak([at(2026,0,1),at(2026,0,2),at(2026,0,2),at(2026,0,3),at(2026,0,7)])).toBe(3);
  expect(longestStreak([at(2026,1,28),at(2026,2,1)])).toBe(2);
 });
});
