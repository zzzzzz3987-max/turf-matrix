import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
  selectBattleWideCandidate: () => null,
  isFiniteNumber: Number.isFinite,
});

test("battle panel renders both opponents and supports missing opponents", () => {
  const race = { indexTop: { number: 1, name: "Axis", tmIndex: 81 }, opponents: [
    { id: "a", number: 2, name: "FirstOpponent" },
    { id: "b", number: 3, name: "SecondOpponent", source: "evidence" },
  ] };
  const html = renderToStaticMarkup(React.createElement(module.exports, { race }));
  assert.match(html, /FirstOpponent/);
  assert.match(html, /SecondOpponent/);
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(module.exports, { race: { ...race, opponents: undefined } })));
});
