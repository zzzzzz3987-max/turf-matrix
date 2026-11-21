import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPublicBattleTicketPlan } from "../../public-battle-ticket-plan.mjs";
import { publicBattlePostTime } from "../../public-battle-snapshot.mjs";

const source = readFileSync(new URL("../../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("const BattleRacePanel =");
const end = source.indexOf("const AllRaceSignalRows =", start);
assert.ok(start >= 0 && end > start);
const code = transformSync(`${source.slice(start, end)}\nmodule.exports = BattleRacePanel;`, { loader: "jsx", format: "cjs" }).code;
const module = { exports: {} };
runInNewContext(code, {
  module, React,
  Num: ({ children }) => React.createElement("span", null, children),
  ChevronRight: () => null,
  buildPublicBattleTicketPlan,
  publicBattlePostTime,
  useState: React.useState,
  useEffect: React.useEffect,
  isFiniteNumber: Number.isFinite,
});

test("started battle panel keeps the saved pre-start ticket plan and marks it as historical", () => {
  const race = { id: '2026-01-01-京都-9R', time: '14:25', oddsStatus: 'active',
    indexTop: { number: 3, name: 'Axis', tmIndex: 82, odds: 1.8 },
    battleCandidates: [6, 7, 4].map(number => ({ number, name: `Partner${number}`, tmIndex: 78, odds: 5 })) };
  race.publicTicketPlan = buildPublicBattleTicketPlan(race);
  const html = renderToStaticMarkup(React.createElement(module.exports, { race, snapshot: { race } }));
  assert.match(html, /発走済み/);
  assert.match(html, /発走前の参考買い目/);
  assert.match(html, /Partner4/);
  assert.match(html, /Partner6/);
  assert.match(html, /Partner7/);
  assert.match(html, /400/);
  assert.doesNotMatch(html, /オッズ確認待ち/);
});

test("started race without a saved plan does not invent tickets or wait for live odds", () => {
  const race = { id: '2026-01-01-京都-9R', time: '14:25', oddsStatus: 'partial',
    indexTop: { number: 3, name: 'Axis', tmIndex: 82, odds: 1.7 } };
  const html = renderToStaticMarkup(React.createElement(module.exports, { race }));
  assert.match(html, /発走済み/);
  assert.match(html, /発走前の買い目記録なし/);
  assert.doesNotMatch(html, /オッズ確認待ち|3連複/);
});

test("battle panel renders both opponents and supports missing opponents", () => {
  const race = { oddsStatus: "active", indexTop: { number: 1, name: "Axis", tmIndex: 81, odds: 4 }, battleCandidates: [
    { id: "a", number: 2, name: "FirstOpponent", tmIndex: 79, odds: 5 },
    { id: "b", number: 3, name: "SecondOpponent", tmIndex: 78, odds: 6 },
  ] };
  const html = renderToStaticMarkup(React.createElement(module.exports, { race }));
  assert.match(html, /FirstOpponent/);
  assert.match(html, /SecondOpponent/);
  assert.match(html, /3連複/);
  assert.doesNotMatch(html, /馬連|ワイド|最低\+/);
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(module.exports, { race: { ...race, battleCandidates: undefined } })));
});
