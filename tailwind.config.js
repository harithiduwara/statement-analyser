/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Figures are read in columns; a tabular numeric face is not optional.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontVariantNumeric: { tabular: 'tabular-nums' },
    },
  },
  plugins: [import('tailwindcss-animate')],
};
