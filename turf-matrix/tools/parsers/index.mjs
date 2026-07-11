import * as allCsvParser from "./all-csv-parser.mjs";
import * as currentRaceDetailParser from "./current-race-detail-parser.mjs";
import * as pedigreeHtmlParser from "./pedigree-html-parser.mjs";
import * as oddsCsvParser from "./odds-csv-parser.mjs";
import * as trainingSlopeHtmlParser from "./training-slope-html-parser.mjs";
import * as trainingWoodHtmlParser from "./training-wood-html-parser.mjs";
import { fileURLToPath } from "node:url";

export const parsers = Object.freeze([
  currentRaceDetailParser,
  allCsvParser,
  trainingSlopeHtmlParser,
  trainingWoodHtmlParser,
  pedigreeHtmlParser,
  oddsCsvParser,
]);

export const inspectParserInputs = () => parsers.map((parser) => parser.inspect());

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(inspectParserInputs(), null, 2));
}
