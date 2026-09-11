import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseTrainingVideo, eligibleVideoReview } from "../intelligence/training-video-evidence.mjs";

const input = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../../data/master/training-video-reviews.json", import.meta.url));
const data = JSON.parse(readFileSync(input, "utf8").replace(/^\uFEFF/, ""));
const reviews = Array.isArray(data.reviews) ? data.reviews : [data];
const diagnostics = reviews.map((review) => ({
  ...diagnoseTrainingVideo(review),
  productionEligible: Boolean(eligibleVideoReview(review, { horseName: review.horseName, currentRace: { raceDate: review.raceDate } }, data.policy)),
}));
console.log(JSON.stringify({ input, count: reviews.length, productionEligible: diagnostics.filter((item) => item.productionEligible).length,
  provisional: diagnostics.filter((item) => item.status === "provisional").length,
  invalid: diagnostics.filter((item) => item.status === "invalid").length, diagnostics }, null, 2));
