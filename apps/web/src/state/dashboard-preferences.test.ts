import { describe,it,expect } from "vitest";
import {DEFAULT_DASHBOARD,moveDashboardCard,parseDashboardPreferences,toggleDashboardCard} from "./dashboard-preferences.js";
describe("dashboard preferences",()=>{
 it("sanitizes malformed and unexpected persisted data",()=>{
  expect(parseDashboardPreferences({order:["updates","updates","invalid"],hidden:["diagnostics","invalid"]})).toEqual({
   order:["updates","diagnostics"],hidden:["diagnostics"]});
  expect(parseDashboardPreferences(null)).toEqual(DEFAULT_DASHBOARD);
 });
 it("moves cards within bounds and toggles visibility",()=>{
  const moved=moveDashboardCard(DEFAULT_DASHBOARD,"updates",-1);
  expect(moved.order).toEqual(["updates","diagnostics"]);
  expect(moveDashboardCard(moved,"updates",-1)).toBe(moved);
  expect(toggleDashboardCard(toggleDashboardCard(moved,"updates"),"updates").hidden).toEqual([]);
 });
});
