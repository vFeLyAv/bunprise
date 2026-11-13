/** Shape helpers shared by both mascots (copied verbatim from the prototypes). */

/** The shared body silhouette (identical in bunny-v1 and hamster-v2). */
export const BODY =
  'M0 -163 C40 -163 64 -140 67 -112 C70 -92 66 -72 67 -59 C72 -50 75 -42 75 -31 C75 -12 64 -1 50 -1 L-50 -1 C-64 -1 -75 -12 -75 -31 C-75 -42 -72 -50 -67 -59 C-66 -72 -70 -92 -67 -112 C-64 -140 -40 -163 0 -163 Z';

/** n-pointed star path (cookie, star eyes). */
export function star(cx: number, cy: number, R: number, r: number, n = 5): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? r : R;
    const a = (-90 + (i * 180) / n) * (Math.PI / 180);
    d += `${i ? 'L' : 'M'}${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)} `;
  }
  return `${d}Z`;
}

/** The cookie the mascots nibble (same in both prototypes). */
export function cookieMarkup(): string {
  return `<g class="cookie"><path d="${star(0, -52, 11, 5.6)}" fill="#F6C25B" stroke="#E3A340" stroke-width="1.6" stroke-linejoin="round"/><circle cx="-2.5" cy="-54" r="1.2" fill="#FFF3D6"/><circle cx="2.8" cy="-50.5" r="1.1" fill="#FFF3D6"/></g>`;
}
