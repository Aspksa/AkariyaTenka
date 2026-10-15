import {describe,it,expect} from "vitest";
import {buildDelaHtmlReport,escapeHtml} from "./dela-report.js";
import type {Task} from "./dela.js";
const task:Task={id:"test",title:"Готово <script>alert(1)</script>",notes:"Проверил & исправил",
 status:"done",priority:"high",due:"2026-10-15",createdAt:1,updatedAt:2,
 repeat:"none",subtasks:[{id:"step",text:"Тест <img src=x>",done:true}]};
describe("Dela HTML report",()=>{
 it("escapes user-authored content and remains standalone",()=>{
  const html=buildDelaHtmlReport([task],{rules:[{id:"due",enabled:true}],events:[
   {id:"due:test:2026-10-15",taskId:"test",rule:"due",date:"2026-10-15",at:"2026-10-15",title:"<iframe>"}
  ]},new Date("2026-10-15T12:00:00Z"));
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<meta charset=\"utf-8\">");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&lt;iframe&gt;");
  expect(html).toContain("&lt;img src=x&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<iframe>");
  expect(html).toContain("Что было сделано (1)");
  expect(html).toContain("Журнал");
  expect(html).not.toContain("https://");
 });
 it("handles empty history and special characters",()=>{
  expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  expect(buildDelaHtmlReport([], {rules:[],events:[]})).toContain("Всего задач");
 });
});