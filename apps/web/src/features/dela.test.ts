import {describe,it,expect} from "vitest";
import {parseTasks,dueState} from "./dela.js";
const sample={id:"test-1",title:"Подготовить выпуск",notes:"",status:"todo",priority:"high",due:"2026-10-20",createdAt:100,updatedAt:100};
describe("Дела",()=>{
 it("accepts valid tasks and rejects corrupt or duplicate records",()=>{
  expect(parseTasks([sample,{...sample,title:"Дубликат"},{...sample,id:"x",status:"bad"},{...sample,id:"y",title:""}])).toEqual([sample]);
  expect(parseTasks(null)).toEqual([]);
 });
 it("enforces bounded title and note lengths",()=>{
  expect(parseTasks([{...sample,title:"a".repeat(161)},{...sample,id:"other",notes:"a".repeat(2001)}])).toEqual([]);
 });
 it("classifies due dates only for unfinished tasks",()=>{
  expect(dueState(sample,"2026-10-21")).toBe("overdue");
  expect(dueState(sample,"2026-10-20")).toBe("today");
  expect(dueState(sample,"2026-10-19")).toBe("future");
  expect(dueState({...sample,status:"done"},"2026-10-21")).toBe("none");
 });
});