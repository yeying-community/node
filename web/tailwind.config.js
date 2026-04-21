/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--app-font-body)'],
        display: ['var(--app-font-display)'],
        body: ['var(--app-font-body)'],
        mono: ['var(--app-font-mono)'],
      },
    },
  },
  plugins: [],
}
