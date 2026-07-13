// TM INDEX Engine v1 deterministic factor integration.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const calculateTmIndex = ({ ability, form, distance, course, training, blood, value, pace }) =>
  clamp(
    ability * 0.28 +
      form * 0.18 +
      distance * 0.13 +
      course * 0.1 +
      training * 0.12 +
      blood * 0.09 +
      value * 0.07 +
      pace * 0.03 +
      8,
    45,
    92
  );

export { calculateTmIndex };
