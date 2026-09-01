import { findCourseBias } from "./dictionaries/course-bias-dictionary.mjs";

const VENUE_GEOMETRY = {
  札幌: { turn: "right", layout: "small", straight: "short", hill: "flat" },
  函館: { turn: "right", layout: "small", straight: "very_short", hill: "flat" },
  福島: { turn: "right", layout: "small", straight: "short", hill: "mild" },
  新潟: { turn: "left", layout: "wide", straight: "long", hill: "mostly_flat" },
  東京: { turn: "left", layout: "wide", straight: "very_long", hill: "mild" },
  中山: { turn: "right", layout: "inner", straight: "short", hill: "steep" },
  中京: { turn: "left", layout: "wide", straight: "long", hill: "steep" },
  京都: { turn: "right", layout: "wide", straight: "medium", hill: "third_corner" },
  阪神: { turn: "right", layout: "wide", straight: "long", hill: "steep" },
  小倉: { turn: "right", layout: "small", straight: "short", hill: "flat" },
};

const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダート" : String(value ?? "");

const resolveCourseGeometry = (race = {}) => {
  const known = findCourseBias(race);
  if (known?.shape) return { ...known.shape, source: "course-profile", profileKey: known.key };
  const course = race.course ?? race.track;
  const surface = normalizeSurface(race.surface);
  const distance = Number(race.distance);
  const base = VENUE_GEOMETRY[course];
  if (!base) return null;

  if (course === "新潟" && surface === "芝" && distance === 1000) {
    return { turn: "straight", layout: "straight", corners: 0, straight: "full_course", hill: "mostly_flat", source: "route-rule" };
  }
  if (course === "新潟" && surface === "芝" && [1600, 1800].includes(distance)) {
    return { ...base, layout: "outer", corners: 2, straight: "very_long", source: "route-rule" };
  }
  if (course === "新潟" && (surface === "ダート" || [1200, 1400, 2200].includes(distance))) {
    return { ...base, layout: "inner", straight: "medium", source: "route-rule" };
  }
  if (surface === "ダート" && ["東京", "中京", "阪神", "京都"].includes(course)) {
    return { ...base, layout: "dirt", source: "venue-surface" };
  }
  return { ...base, source: "venue-default" };
};

const courseGeometryStyles = (shape, surface) => {
  if (!shape) return { favored: [], opposed: [] };
  if (shape.turn === "straight") return { favored: ["逃げ", "先行"], opposed: [] };
  if (["small", "inner"].includes(shape.layout) || ["short", "very_short"].includes(shape.straight)) {
    return { favored: ["逃げ", "先行"], opposed: ["追込"] };
  }
  if (normalizeSurface(surface) === "ダート") return { favored: ["逃げ", "先行"], opposed: ["追込"] };
  if (shape.layout === "outer" || shape.straight === "very_long") return { favored: ["差し", "追込"], opposed: ["逃げ"] };
  return { favored: [], opposed: [] };
};

export { VENUE_GEOMETRY, courseGeometryStyles, resolveCourseGeometry };
