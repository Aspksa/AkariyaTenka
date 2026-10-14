import {describe,it,expect} from "vitest";
import {parseNotices,parseNoticeSettings} from "./notifications.js";
describe("notification persistence",()=>{
 it("accepts only bounded safe entries",()=>{
 const valid={id:"update:123",kind:"update",title:"New version",detail:"Ready",at:100,read:false};
 expect(parseNotices([valid,{...valid,kind:"script"},{...valid,title:"x".repeat(200)},null])).toEqual([valid]);
 expect(parseNotices({})).toEqual([]);
   it("validates notification preferences with safe defaults",()=>{
  expect(parseNoticeSettings(null)).toEqual({showUpdates:true,showErrors:true,showInfo:true,unreadOnly:false});
  expect(parseNoticeSettings({showUpdates:false,showErrors:"no",unreadOnly:true})).toEqual({showUpdates:false,showErrors:true,showInfo:true,unreadOnly:true});
 });
});
 it("deduplicates persisted notices by stable event id",()=>{
  const first={id:"update:abc",kind:"update",title:"Available",detail:"Ready",at:100,read:false};
  const newest={...first,detail:"Latest",at:200};
  expect(parseNotices([first,newest,first])).toEqual([first]);
  expect(parseNotices([first,newest])).toEqual([newest]);
 });
});
