/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // TURF MATRIX ブランドカラー
        "tm-navy": "#0A1021",
        "tm-teal": "#00C2B8",
        "tm-emerald": "#22E6A2",
        "tm-blue": "#2D7BFF",
      },
    },
  },
  plugins: [],
};
