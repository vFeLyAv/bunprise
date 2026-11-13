// Vite's `?raw` imports: the gallery and its test read splash.html and boot.js as text (vite/client types are not
// loaded in this package, tsconfig "types": []).
declare module '*?raw' {
  const text: string;
  export default text;
}
