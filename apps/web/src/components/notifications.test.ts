import {describe,it,expect} from "vitest";
import {parseNotices} from "./notifications.js";
describe("notification persistence",()=>{
 it("accepts only bounded safe entries",()=>{
 const valid={id:"update:123",kind:"update",title:"New version",detail:"Ready",at:100,read:false};
 expect(parseNotices([valid,{...valid,kind:"script"},{...valid,title:"x".repeat(200)},null])).toEqual([valid]);
 expect(parseNotices({})).toEqual([]);
 });
});
