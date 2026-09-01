import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJbisHorseCandidates,
  normalizeHorseName,
} from "../../pedigree/jbis-pedigree-resolver.mjs";

test("JBIS resolver extracts only exact horse-name result links", () => {
  const html = `
    <a href="/horse/0001327411/" class="txt-link">シャイニースイフト</a>
    <a href="/horse/0001090769/" class="txt-link">ダノンバラード</a>
    <a href="/horse/0001327411/pedigree/" class="tag-result-pedigree">血統</a>
  `;
  assert.deepEqual(extractJbisHorseCandidates(html, "シャイニースイフト"), [{
    jbisHorseId: "0001327411",
    horseName: "シャイニースイフト",
  }]);
});

test("JBIS resolver normalizes whitespace and HTML entities deterministically", () => {
  assert.equal(normalizeHorseName(" Heart&apos;s  Cry "), "Heart'sCry");
  assert.equal(normalizeHorseName("テスト＊馬"), "テスト馬");
  assert.equal(normalizeHorseName("マテンロウサン(USA)"), "マテンロウサン");
});

test("JBIS resolver accepts a terminal country code without weakening exact-name matching", () => {
  const html = `
    <a href="/horse/0001399969/">マテンロウサン(USA)</a>
    <a href="/horse/0000000001/">マテンロウサンダー(JPN)</a>
  `;
  assert.deepEqual(extractJbisHorseCandidates(html, "マテンロウサン"), [
    { jbisHorseId: "0001399969", horseName: "マテンロウサン" },
  ]);
});
