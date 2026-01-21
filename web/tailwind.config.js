/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        puhuiBold: ['Puhui-Bold'],
        puhuiRegular: ['Puhui-Regular'],
        puhuiMedium: ['Puhui-Medium'],
      },
    },
  },
  plugins: [],
}