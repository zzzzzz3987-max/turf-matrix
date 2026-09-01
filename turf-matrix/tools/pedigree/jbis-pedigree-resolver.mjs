const decodeHtmlEntities = (value) => String(value ?? "")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&apos;|&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const normalizeHorseName = (value) => decodeHtmlEntities(value)
  .replace(/<[^>]*>/g, "")
  .normalize("NFKC")
  .replace(/\((?:[A-Z]{2,3}|JPN)\)$/i, "")
  .replace(/[＊*$]/g, "")
  .replace(/\s+/g, "")
  .trim();

const extractJbisHorseCandidates = (html, horseName) => {
  const expected = normalizeHorseName(horseName);
  const candidates = [...String(html ?? "").matchAll(
    /<a\b[^>]*href=["']\/horse\/(\d+)\/["'][^>]*>([\s\S]*?)<\/a>/gi,
  )]
    .map((match) => ({
      jbisHorseId: match[1],
      horseName: normalizeHorseName(match[2]),
    }))
    .filter((candidate) => candidate.horseName === expected);
  return [...new Map(candidates.map((candidate) => [candidate.jbisHorseId, candidate])).values()];
};

export {
  extractJbisHorseCandidates,
  normalizeHorseName,
};
