import { scoreCourse, buildCourseSurfaceEvidence } from "../../intelligence/course-ai.mjs";
import { createFactorOnlyShadow } from "./factor-only-shadow.mjs";

export const COURSE_SURFACE_VERSION = "course-same-surface-v1";
const shadow = createFactorOnlyShadow({
  factor: "course", label: "Course", version: COURSE_SURFACE_VERSION,
  policy: { changedFactor: "course", weightsChanged: false, formChanged: false, resultsRead: false },
  scoreCurrent: scoreCourse,
  scoreCandidate: (horse) => scoreCourse(horse, { sameSurfaceOnly: true }),
  buildEvidence: (horse) => {
    const evidence = buildCourseSurfaceEvidence(horse);
    if (!evidence.surface) throw new Error("Course surface is unknown or unsupported");
    return {
      surface: evidence.surface, sameSurfaceRuns: evidence.sameSurface.length,
      sameCourseRuns: evidence.sameCourse.length, sameTypeRuns: evidence.sameType.length,
      excludedSurfaceRuns: evidence.excludedSurfaceCount,
    };
  },
});

export const buildCourseSurfacePrediction = shadow.buildPrediction;
export const buildCourseSurfaceArtifact = shadow.buildArtifact;
export const validateCourseSurfaceArtifact = shadow.validateArtifact;
export const evaluateCourseSurfaceArtifact = shadow.evaluateArtifact;
