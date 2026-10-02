import { scoreCourse, scoreLegacyCourse, COURSE_PERFORMANCE_POLICY, buildCourseSurfaceEvidence } from "../../intelligence/course-ai.mjs";
import { createFactorOnlyShadow } from "./factor-only-shadow.mjs";

export const COURSE_SURFACE_VERSION = "course-same-surface-v1";
const shadow = createFactorOnlyShadow({
  factor: "course", label: "Course", version: COURSE_SURFACE_VERSION,
  policy: { changedFactor: "course", weightsChanged: false, formChanged: false, resultsRead: false },
  scoreCurrent: (horse) => horse.analysis?.course?.performanceProfile?.policy === COURSE_PERFORMANCE_POLICY
    ? scoreCourse(horse) : scoreLegacyCourse(horse),
  scoreCandidate: (horse) => horse.analysis?.course?.performanceProfile?.policy === COURSE_PERFORMANCE_POLICY
    ? scoreCourse(horse)
    : buildCourseSurfaceEvidence(horse).surface
      ? scoreLegacyCourse(horse, { sameSurfaceOnly: true })
      : scoreLegacyCourse(horse),
  buildEvidence: (horse) => {
    const evidence = buildCourseSurfaceEvidence(horse);
    return {
      surface: evidence.surface, sameSurfaceRuns: evidence.sameSurface.length,
      sameCourseRuns: evidence.sameCourse.length, sameTypeRuns: evidence.sameType.length,
      excludedSurfaceRuns: evidence.excludedSurfaceCount,
      comparisonStatus: evidence.surface ? "comparable" : "not-applicable",
    };
  },
});

export const buildCourseSurfacePrediction = shadow.buildPrediction;
export const buildCourseSurfaceArtifact = shadow.buildArtifact;
export const validateCourseSurfaceArtifact = shadow.validateArtifact;
export const evaluateCourseSurfaceArtifact = shadow.evaluateArtifact;
