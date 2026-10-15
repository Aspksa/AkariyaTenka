import {afterEach,describe,expect,it} from "vitest";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {DelaStore,nextDue,parseDela} from "./dela-store.js";
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const task=(id="t1")=>({id,title:"Модуль Дела",notes:"Тестовый проект",status:"todo",priority:"high",
 due:"2026-10-15",repeat:"weekly",subtasks:[{id:"s1",text:"Проверить",done:false}],
 createdAt:100,updatedAt:100});
describe("persistent Дела service",()=>{
 it("rejects malformed values",()=>{
  expect(parseDela([task(),{...task("other"),repeat:"invalid"},null])).toEqual([task()]);
 });
 it("calculates recurring dates including month ends",()=>{
  expect(nextDue("2026-10-15","daily")).toBe("2026-10-16");
  expect(nextDue("2026-10-15","weekly")).toBe("2026-10-22");
  expect(nextDue("2026-01-31","monthly")).toBe("2026-02-28");
  expect(nextDue("2026-10-15","none")).toBe("");
 });
 it("persists tasks across store instances and deletes them",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"akariya-dela-"));dirs.push(dir);
  const a=new DelaStore(dir);await a.init();
  expect(await a.change({action:"upsert",task:task()})).toHaveLength(1);
  const b=new DelaStore(dir);await b.init();
  expect(await b.list()).toEqual([task()]);
  expect(JSON.parse(await readFile(path.join(dir,"dela-tasks.json"),"utf8"))).toHaveLength(1);
  expect(await b.dueNotifications("2026-10-15")).toHaveLength(1);
  expect(await b.change({action:"delete",id:"t1"})).toEqual([]);
 });
 it("does not store malformed writes",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"akariya-dela-"));dirs.push(dir);
  const store=new DelaStore(dir);await store.init();
  await expect(store.change({action:"upsert",task:{...task(),title:""}})).rejects.toThrow();
  expect(await store.list()).toEqual([]);
 });
});
