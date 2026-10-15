import {afterEach,describe,expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {DelaStore} from "./dela-store.js";
import {DelaAutomation} from "./dela-automation.js";
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const task={id:"t1",title:"Выпустить версию",notes:"",status:"todo",priority:"high",due:"2026-10-15",
 repeat:"none",subtasks:[],createdAt:1,updatedAt:1};
describe("Dela server automation",()=>{
 it("records due events once across repeated checks and restart",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"dela-auto-"));dirs.push(dir);
  const tasks=new DelaStore(dir);await tasks.init();await tasks.change({action:"upsert",task});
  const rules=new DelaAutomation(dir,tasks);await rules.init();
  expect(await rules.tick("2026-10-15")).toBe(1);
  expect(await rules.tick("2026-10-15")).toBe(0);
  const restored=new DelaAutomation(dir,tasks);await restored.init();
  expect(await restored.tick("2026-10-15")).toBe(0);
  expect((await restored.snapshot()).events).toHaveLength(1);
 });
 it("pauses overdue rule without deleting history",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"dela-auto-"));dirs.push(dir);
  const tasks=new DelaStore(dir);await tasks.init();await tasks.change({action:"upsert",task});
  const automation=new DelaAutomation(dir,tasks);await automation.init();
  await automation.setRule({id:"overdue",enabled:false});
  expect(await automation.tick("2026-10-16")).toBe(0);
  await automation.setRule({id:"overdue",enabled:true});
  expect(await automation.tick("2026-10-16")).toBe(1);
  expect(await automation.tick("2026-10-17")).toBe(0);
  await expect(automation.setRule({id:"random",enabled:true})).rejects.toThrow();
 });
});