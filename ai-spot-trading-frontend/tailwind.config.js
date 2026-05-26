/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#062A0D",
        primary: "#71C829",
        card: "rgba(255, 255, 255, 0.05)",
        binance: "#F0B90B"
      },
      fontFamily: {
        sans: ['League Spartan', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
