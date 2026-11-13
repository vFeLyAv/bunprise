import { Canvas, Floor, Sparkle } from './kit'

// Demo drawings: home & living, plants, travel, self-care. Own flat drawings, token colours only.

export function CandleArt() {
  return (
    <Canvas label="candle">
      <Floor rx={30} />
      <circle cx="60" cy="38" r="22" fill="var(--gift-butter)" opacity=".35" />
      <circle cx="60" cy="38" r="12" fill="var(--gift-butter)" opacity=".45" />
      {/* the glass */}
      <rect x="34" y="50" width="52" height="52" rx="12" fill="var(--gift-sky-light)" opacity=".9" />
      {/* the wax inside */}
      <rect x="38" y="60" width="44" height="38" rx="9" fill="var(--gift-cream)" />
      <ellipse cx="60" cy="61" rx="21" ry="4" fill="var(--surface)" />
      {/* the label */}
      <rect x="42" y="74" width="36" height="16" rx="3.5" fill="var(--accent-300)" />
      <path d="M50 82 H70" stroke="var(--accent-600)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      <rect x="38" y="54" width="6" height="40" rx="3" fill="var(--surface)" opacity=".55" />
      {/* wick and flame */}
      <path d="M60 60 V52" stroke="var(--gift-charcoal)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M60 28 C68 38 66 48 60 51 C54 48 52 38 60 28 Z" fill="var(--accent-400)" />
      <path d="M60 37 C64 42 63 48 60 49.5 C57 48 56 42 60 37 Z" fill="var(--gift-butter)" />
    </Canvas>
  )
}

export function LightsArt() {
  const bulbs: Array<[number, number, number, string]> = [
    [20, 47, 28, 'var(--gift-butter)'],
    [36, 58, 10, 'var(--gift-rose)'],
    [52, 58, -12, 'var(--accent-300)'],
    [66, 49, -28, 'var(--gift-butter)'],
    [82, 42, 4, 'var(--gift-leaf-light)'],
    [98, 49, 30, 'var(--gift-rose)'],
    [28, 86, 22, 'var(--accent-300)'],
    [46, 93, 2, 'var(--gift-butter)'],
    [64, 90, -16, 'var(--gift-sky)'],
    [82, 82, -10, 'var(--gift-rose)'],
    [98, 84, 24, 'var(--gift-butter)'],
  ]
  return (
    <Canvas label="lights">
      <Floor rx={40} y={108} />
      <path d="M8 38 C24 58 44 66 62 48 C76 34 94 34 112 50" stroke="var(--gift-charcoal)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M12 76 C30 96 50 100 66 86 C80 74 96 76 112 88" stroke="var(--gift-charcoal)" strokeWidth="2" fill="none" strokeLinecap="round" />
      {bulbs.map(([x, y, angle, fill]) => (
        <g key={`${x}-${y}`} transform={`rotate(${angle} ${x} ${y})`}>
          <circle cx={x} cy={y + 9} r="9" fill={fill} opacity=".28" />
          <rect x={x - 2.4} y={y} width="4.8" height="4" rx="1" fill="var(--gift-charcoal)" />
          <path d={`M${x} ${y + 3.5} C${x + 5.5} ${y + 7} ${x + 5} ${y + 14} ${x} ${y + 15.5} C${x - 5} ${y + 14} ${x - 5.5} ${y + 7} ${x} ${y + 3.5} Z`} fill={fill} />
          <ellipse cx={x - 1.6} cy={y + 8.5} rx="1.2" ry="2.4" fill="var(--surface)" opacity=".75" />
        </g>
      ))}
    </Canvas>
  )
}

export function BlanketArt() {
  return (
    <Canvas label="blanket">
      <Floor rx={40} />
      {/* the folded blanket below */}
      <rect x="18" y="70" width="84" height="32" rx="10" fill="var(--gift-rose)" />
      {[30, 44, 58, 72, 86].map((x) => (
        <rect key={x} x={x} y="70" width="5" height="32" fill="var(--surface)" opacity=".38" />
      ))}
      <rect x="18" y="86" width="84" height="5" fill="var(--surface)" opacity=".38" />
      <rect x="18" y="94" width="84" height="8" rx="4" fill="var(--gift-rose-dark)" opacity=".4" />
      {/* the folded one on top */}
      <rect x="26" y="46" width="70" height="28" rx="9" fill="var(--gift-cream)" />
      <rect x="26" y="54" width="70" height="4" fill="var(--accent-300)" opacity=".8" />
      <rect x="26" y="62" width="70" height="4" fill="var(--accent-300)" opacity=".8" />
      <rect x="26" y="68" width="70" height="6" rx="3" fill="var(--gift-wood-light)" opacity=".5" />
      {/* the leather tag */}
      <rect x="82" y="44" width="10" height="16" rx="2.5" fill="var(--gift-wood)" />
      <circle cx="87" cy="48" r="1.4" fill="var(--gift-cream)" />
      <Sparkle x={20} y={48} r={4.2} />
    </Canvas>
  )
}

export function LampArt() {
  return (
    <Canvas label="lamp">
      <Floor rx={28} />
      <circle cx="60" cy="58" r="40" fill="var(--gift-butter)" opacity=".22" />
      <circle cx="60" cy="58" r="26" fill="var(--gift-butter)" opacity=".3" />
      {/* the shade */}
      <path d="M28 60 C28 36 44 24 60 24 C76 24 92 36 92 60 Z" fill="var(--gift-butter)" />
      <path d="M36 52 C38 40 46 32 56 30" stroke="var(--surface)" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7" />
      <ellipse cx="60" cy="60" rx="32" ry="5.5" fill="var(--gift-butter-dark)" />
      <ellipse cx="60" cy="61" rx="18" ry="3" fill="var(--surface)" />
      {/* stem and base */}
      <rect x="56" y="62" width="8" height="32" rx="3" fill="var(--gift-steel)" />
      <ellipse cx="60" cy="98" rx="22" ry="6.5" fill="var(--gift-charcoal)" />
      <ellipse cx="60" cy="96" rx="18" ry="4" fill="var(--gift-steel-dark)" />
      {/* "smart": a little signal */}
      <path d="M92 22 a8 8 0 0 1 8 8" stroke="var(--gift-sky-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M92 15 a15 15 0 0 1 15 15" stroke="var(--gift-sky-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".6" />
      <circle cx="92" cy="30" r="2.4" fill="var(--gift-sky-dark)" />
    </Canvas>
  )
}

export function PlantArt() {
  const leaf = (x: number, y: number, angle: number, scale: number, fill: string) => (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path d="M0 0 C-16 -2 -24 -22 -14 -36 C-6 -46 8 -46 14 -36 C24 -22 16 -2 0 0 Z" fill={fill} />
      <path d="M0 -2 V-38" stroke="var(--gift-leaf-dark)" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <path d="M-15 -14 L-6 -16 M-17 -26 L-6 -26 M15 -14 L6 -16 M16 -26 L6 -26" stroke="var(--gift-cream)" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  )
  return (
    <Canvas label="plant">
      <Floor rx={28} />
      {/* stems */}
      <path d="M58 72 C54 58 44 50 36 44" stroke="var(--gift-leaf-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M60 72 C62 54 66 42 72 30" stroke="var(--gift-leaf-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M62 72 C70 62 80 58 90 56" stroke="var(--gift-leaf-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {leaf(36, 48, -52, 0.85, 'var(--gift-leaf)')}
      {leaf(72, 34, 8, 0.95, 'var(--gift-leaf-light)')}
      {leaf(90, 60, 62, 0.8, 'var(--gift-leaf)')}
      {/* the pot */}
      <path d="M36 74 H84 L78 102 H42 Z" fill="var(--gift-clay)" />
      <path d="M70 74 H84 L78 102 H70 Z" fill="var(--gift-clay-dark)" opacity=".45" />
      <rect x="32" y="68" width="56" height="10" rx="4" fill="var(--gift-clay-dark)" />
      <path d="M44 86 Q52 82 60 86 T76 86" stroke="var(--gift-cream)" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity=".8" />
    </Canvas>
  )
}

export function HerbsArt() {
  const pot = (x: number) => (
    <g>
      <path d={`M${x} 74 H${x + 28} L${x + 24} 98 H${x + 4} Z`} fill="var(--gift-clay)" />
      <rect x={x - 2} y="70" width="32" height="7" rx="3" fill="var(--gift-clay-dark)" />
    </g>
  )
  return (
    <Canvas label="herbs">
      <Floor rx={44} />
      {/* the tray */}
      <rect x="10" y="96" width="100" height="8" rx="4" fill="var(--gift-wood)" />
      {/* basil */}
      {[[24, 58, 8], [32, 52, 7], [20, 48, 6.5], [30, 42, 6], [36, 62, 6]].map(([cx, cy, r]) => (
        <ellipse key={`b${cx}${cy}`} cx={cx} cy={cy} rx={r} ry={(r ?? 0) * 0.72} fill="var(--gift-leaf)" transform={`rotate(-20 ${cx} ${cy})`} />
      ))}
      <path d="M28 70 V56" stroke="var(--gift-leaf-dark)" strokeWidth="2" strokeLinecap="round" />
      {pot(14)}
      {/* rosemary */}
      {[50, 56, 62, 68].map((x, i) => (
        <path key={`r${x}`} d={`M${x + 2} 72 C${x} 58 ${x + 4} 44 ${x + (i % 2 ? 6 : -2)} 32`} stroke="var(--gift-leaf-dark)" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeDasharray="1.4 2.2" />
      ))}
      {pot(46)}
      {/* chives */}
      {[82, 86, 90, 94, 98].map((x, i) => (
        <path key={`c${x}`} d={`M${x} 72 C${x - 2} 56 ${x + (i - 2) * 3} 42 ${x + (i - 2) * 5} 34`} stroke="var(--gift-leaf-light)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      ))}
      <circle cx="98" cy="34" r="4" fill="var(--gift-rose)" />
      {pot(78)}
    </Canvas>
  )
}

export function MapArt() {
  return (
    <Canvas label="map">
      <Floor rx={42} />
      {/* the poster, a little curled */}
      <rect x="14" y="32" width="92" height="64" rx="5" fill="var(--gift-sky-light)" />
      <rect x="14" y="32" width="92" height="6" rx="3" fill="var(--gift-sky)" opacity=".7" />
      {/* the continents: scratched open (colour) and still golden */}
      <path d="M26 50 C32 44 44 46 46 54 C48 62 40 64 38 72 C36 78 30 76 30 70 C30 64 22 58 26 50 Z" fill="var(--gift-leaf)" />
      <path d="M52 46 C60 42 70 46 72 52 C70 56 64 56 62 60 C58 58 54 56 52 52 Z" fill="var(--gift-butter-dark)" />
      <path d="M58 62 C64 60 70 64 68 72 C66 80 60 84 58 78 C56 72 54 66 58 62 Z" fill="var(--gift-butter-dark)" />
      <path d="M74 48 C84 42 98 46 98 56 C98 62 90 62 86 66 C80 64 76 58 74 48 Z" fill="var(--gift-clay)" />
      <path d="M86 74 C92 72 98 76 96 82 C92 86 86 84 86 74 Z" fill="var(--gift-butter-dark)" />
      {/* a flight between two places */}
      <path d="M38 58 C50 40 70 38 84 54" stroke="var(--gift-charcoal)" strokeWidth="1.6" fill="none" strokeDasharray="3 3" strokeLinecap="round" />
      <path d="M84 50 C84 45 90 45 90 50 C90 54 87 57 87 57 C87 57 84 54 84 50 Z" fill="var(--gift-rose-dark)" transform="translate(-3 0)" />
      <circle cx="84" cy="49.8" r="1.6" fill="var(--surface)" />
      {/* the coin that scratches */}
      <circle cx="98" cy="96" r="8" fill="var(--gift-butter)" />
      <circle cx="98" cy="96" r="5.4" fill="none" stroke="var(--gift-butter-dark)" strokeWidth="1.4" />
    </Canvas>
  )
}

export function PillowArt() {
  return (
    <Canvas label="pillow">
      <Floor rx={38} />
      {/* the U of the pillow: two arms, a wide opening for the neck at the top */}
      <path d="M60 100 C30 100 14 82 14 62 C14 42 26 26 40 26 C50 26 53 36 50 46 C47 56 50 68 60 68 C70 68 73 56 70 46 C67 36 70 26 80 26 C94 26 106 42 106 62 C106 82 90 100 60 100 Z" fill="var(--gift-sky)" />
      <path d="M60 100 C30 100 14 82 14 62 C18 82 36 92 60 92 C84 92 102 82 106 62 C106 82 90 100 60 100 Z" fill="var(--gift-sky-dark)" opacity=".35" />
      <path d="M60 90 C36 90 22 78 22 62 C22 46 30 34 40 34 C44 34 45 38 44 42" stroke="var(--surface)" strokeWidth="1.8" fill="none" strokeDasharray="3 3.4" strokeLinecap="round" opacity=".85" />
      <path d="M76 42 C75 38 76 34 80 34 C90 34 98 46 98 62 C98 78 84 90 60 90" stroke="var(--surface)" strokeWidth="1.8" fill="none" strokeDasharray="3 3.4" strokeLinecap="round" opacity=".85" />
      <ellipse cx="30" cy="48" rx="6" ry="10" fill="var(--surface)" opacity=".3" transform="rotate(-24 30 48)" />
      {/* the snap that closes it */}
      <rect x="45" y="40" width="9" height="7" rx="3" fill="var(--accent-400)" transform="rotate(-12 49.5 43.5)" />
      <rect x="66" y="40" width="9" height="7" rx="3" fill="var(--accent-400)" transform="rotate(12 70.5 43.5)" />
      <Sparkle x={104} y={30} r={4} />
    </Canvas>
  )
}

export function BathsetArt() {
  return (
    <Canvas label="bathset">
      <Floor rx={44} />
      {/* the salt jar */}
      <rect x="16" y="50" width="38" height="50" rx="10" fill="var(--gift-sky-light)" opacity=".95" />
      <rect x="19" y="62" width="32" height="35" rx="7" fill="var(--gift-rose)" opacity=".75" />
      {[[26, 70], [34, 76], [42, 68], [30, 86], [44, 84], [38, 92]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" fill="var(--surface)" opacity=".85" />
      ))}
      <rect x="20" y="54" width="5" height="40" rx="2.5" fill="var(--surface)" opacity=".5" />
      <rect x="13" y="42" width="44" height="11" rx="4" fill="var(--gift-wood)" />
      <rect x="13" y="42" width="44" height="3.5" rx="1.75" fill="var(--gift-wood-light)" />
      {/* the bottle */}
      <rect x="64" y="44" width="24" height="40" rx="8" fill="var(--gift-leaf-light)" />
      <rect x="70" y="36" width="12" height="10" rx="2" fill="var(--gift-steel-dark)" />
      <path d="M76 36 V28 H86" stroke="var(--gift-steel-dark)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="68" y="56" width="16" height="12" rx="2.5" fill="var(--gift-cream)" />
      {/* the soap bar */}
      <rect x="58" y="82" width="46" height="20" rx="8" fill="var(--gift-butter)" />
      <rect x="58" y="94" width="46" height="8" rx="4" fill="var(--gift-butter-dark)" opacity=".5" />
      <ellipse cx="72" cy="88" rx="7" ry="2.4" fill="var(--surface)" opacity=".7" />
      <circle cx="100" cy="74" r="3.4" fill="none" stroke="var(--gift-sky)" strokeWidth="1.4" />
      <circle cx="106" cy="66" r="2.2" fill="none" stroke="var(--gift-sky)" strokeWidth="1.2" />
    </Canvas>
  )
}

export function TubesArt() {
  const tube = (x: number, fill: string, tilt: number) => (
    <g transform={`rotate(${tilt} ${x + 12} 100)`}>
      <path d={`M${x + 3} 34 H${x + 21} L${x + 25} 82 H${x - 1} Z`} fill={fill} />
      <path d={`M${x + 16} 34 H${x + 21} L${x + 25} 82 H${x + 18} Z`} fill="var(--gift-charcoal)" opacity=".08" />
      <rect x={x + 2} y="29" width="20" height="6" rx="1.5" fill="var(--surface)" opacity=".9" />
      <path d={`M${x + 4} 32 H${x + 20}`} stroke={fill} strokeWidth="1" strokeDasharray="1.2 1.4" />
      <rect x={x + 4} y="52" width="16" height="12" rx="2.5" fill="var(--surface)" opacity=".75" />
      <rect x={x} y="82" width="24" height="18" rx="4" fill="var(--gift-cream)" />
      <rect x={x} y="96" width="24" height="4" rx="2" fill="var(--gift-steel)" opacity=".6" />
    </g>
  )
  return (
    <Canvas label="tubes">
      <Floor rx={38} />
      {tube(22, 'var(--gift-rose)', -8)}
      {tube(48, 'var(--gift-leaf-light)', 0)}
      {tube(74, 'var(--gift-butter)', 8)}
      <Sparkle x={18} y={36} r={4} />
    </Canvas>
  )
}
