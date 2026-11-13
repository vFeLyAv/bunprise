import { Canvas, Floor, Sparkle } from './kit'

// Demo drawings: coffee & tea, kitchen, movie night, flasks. Own flat drawings, token colours only.

export function GrinderArt() {
  return (
    <Canvas label="grinder">
      <Floor rx={30} />
      {/* beans */}
      <ellipse cx="26" cy="100" rx="4.6" ry="3.2" fill="var(--gift-wood-dark)" transform="rotate(-24 26 100)" />
      <path d="M23.4 101.6 Q26 99.2 28.6 98.4" stroke="var(--gift-wood-light)" strokeWidth="1" fill="none" strokeLinecap="round" />
      <ellipse cx="94" cy="101" rx="4.2" ry="3" fill="var(--gift-wood-dark)" transform="rotate(18 94 101)" />
      <path d="M91.6 100.4 Q94 102 96.6 101.8" stroke="var(--gift-wood-light)" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* the wooden body */}
      <rect x="38" y="52" width="44" height="50" rx="9" fill="var(--gift-wood)" />
      <rect x="68" y="52" width="14" height="50" rx="7" fill="var(--gift-wood-dark)" opacity=".45" />
      <rect x="43" y="56" width="5" height="40" rx="2.5" fill="var(--gift-wood-light)" opacity=".6" />
      {/* the little drawer */}
      <rect x="47" y="76" width="26" height="14" rx="3.5" fill="var(--gift-wood-dark)" />
      <circle cx="60" cy="83" r="2.4" fill="var(--gift-steel-light)" />
      {/* metal top and dome */}
      <rect x="40" y="43" width="40" height="11" rx="4" fill="var(--gift-steel)" />
      <rect x="40" y="43" width="40" height="3.5" rx="1.75" fill="var(--gift-steel-light)" />
      <path d="M45 43 C47 33 73 33 75 43 Z" fill="var(--gift-steel-dark)" />
      <path d="M50 40 C52 36 58 35 62 35.6" stroke="var(--gift-steel-light)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* the crank */}
      <rect x="58" y="24" width="4.5" height="13" rx="2" fill="var(--gift-steel-dark)" />
      <path d="M60 26 L88 20" stroke="var(--gift-steel-dark)" strokeWidth="4.5" strokeLinecap="round" />
      <ellipse cx="90.5" cy="15.5" rx="5.5" ry="6.8" fill="var(--gift-wood-dark)" />
      <ellipse cx="89" cy="13.5" rx="1.6" ry="2.4" fill="var(--gift-wood-light)" opacity=".7" />
      <Sparkle x={24} y={40} r={4.5} />
    </Canvas>
  )
}

export function PouroverArt() {
  return (
    <Canvas label="pourover">
      <Floor rx={30} />
      {/* steam */}
      <path d="M52 26 C48 21 56 18 52 12" stroke="var(--text-3)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".45" />
      <path d="M66 24 C62 19 70 16 66 10" stroke="var(--text-3)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".35" />
      {/* the cup */}
      <path d="M88 76 C99 76 99 92 87 92" stroke="var(--gift-cream)" strokeWidth="6" fill="none" strokeLinecap="round" />
      <rect x="36" y="64" width="52" height="38" rx="11" fill="var(--gift-cream)" />
      <rect x="36" y="64" width="52" height="8" rx="4" fill="var(--surface)" />
      <rect x="74" y="66" width="12" height="34" rx="6" fill="var(--gift-steel)" opacity=".35" />
      <path d="M44 82 H80" stroke="var(--gift-clay)" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      {/* the dripper */}
      <path d="M30 36 H94 L80 62 H44 Z" fill="var(--gift-clay)" strokeLinejoin="round" />
      <path d="M44 62 H80 L77 67 H47 Z" fill="var(--gift-clay-dark)" />
      <rect x="27" y="32" width="70" height="8" rx="4" fill="var(--gift-clay-dark)" />
      <path d="M38 40 L46 56" stroke="var(--surface)" strokeWidth="2.6" strokeLinecap="round" opacity=".45" />
      {/* the paper filter peeking over the rim */}
      <path d="M40 32 L60 22 L84 32 Z" fill="var(--surface)" />
      <path d="M60 22 L60 32" stroke="var(--separator)" strokeWidth="1.2" />
      <Sparkle x={100} y={52} r={4} />
    </Canvas>
  )
}

export function TeapotArt() {
  return (
    <Canvas label="teapot">
      <Floor rx={34} />
      {/* handle and spout */}
      <path d="M30 60 C12 58 12 90 32 88" stroke="var(--gift-sky-dark)" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M84 70 C96 66 96 52 104 46 C106 45 108 47 107 49 C102 56 102 76 88 86 Z" fill="var(--gift-sky)" />
      {/* the round body */}
      <ellipse cx="58" cy="74" rx="32" ry="27" fill="var(--gift-sky)" />
      <path d="M28 80 C38 98 78 98 88 80 C82 92 70 101 58 101 C44 101 32 93 28 80 Z" fill="var(--gift-sky-dark)" opacity=".35" />
      <path d="M30 70 Q58 80 86 70" stroke="var(--surface)" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity=".55" />
      <circle cx="44" cy="71" r="2.2" fill="var(--surface)" opacity=".7" />
      <circle cx="58" cy="74" r="2.2" fill="var(--surface)" opacity=".7" />
      <circle cx="72" cy="71" r="2.2" fill="var(--surface)" opacity=".7" />
      <ellipse cx="43" cy="62" rx="6" ry="9" fill="var(--surface)" opacity=".35" transform="rotate(28 43 62)" />
      {/* lid */}
      <ellipse cx="58" cy="50" rx="20" ry="6" fill="var(--gift-sky-dark)" />
      <ellipse cx="58" cy="48.5" rx="15" ry="4" fill="var(--gift-sky)" />
      <circle cx="58" cy="41" r="5" fill="var(--gift-sky-dark)" />
      {/* the tea bag tag */}
      <path d="M74 50 L80 60" stroke="var(--text-3)" strokeWidth="1.2" />
      <rect x="77" y="58" width="9" height="8" rx="1.5" fill="var(--accent-300)" transform="rotate(14 81.5 62)" />
    </Canvas>
  )
}

export function KnifeArt() {
  return (
    <Canvas label="knife">
      <Floor rx={42} />
      {/* the cutting board */}
      <rect x="14" y="58" width="92" height="40" rx="12" fill="var(--gift-wood-light)" />
      <rect x="14" y="90" width="92" height="8" rx="4" fill="var(--gift-wood)" />
      <circle cx="96" cy="70" r="4" fill="var(--gift-wood)" />
      <path d="M24 70 C40 67 54 72 70 69" stroke="var(--gift-wood)" strokeWidth="1.4" fill="none" opacity=".5" />
      <path d="M26 80 C44 77 60 83 82 79" stroke="var(--gift-wood)" strokeWidth="1.4" fill="none" opacity=".45" />
      {/* the knife */}
      <path d="M18 48 L74 40 L76 52 L26 58 C20 58 16 53 18 48 Z" fill="var(--gift-steel-light)" />
      <path d="M18 48 L74 40 L74.6 44 L20 51 Z" fill="var(--surface)" opacity=".75" />
      <path d="M26 58 L76 52 L75.5 49 L28 55 Z" fill="var(--gift-steel-dark)" opacity=".55" />
      <rect x="73" y="38" width="34" height="13" rx="6.5" fill="var(--gift-wood-dark)" transform="rotate(-8 73 38)" />
      <circle cx="83" cy="43.6" r="1.6" fill="var(--gift-steel-light)" />
      <circle cx="93" cy="42.2" r="1.6" fill="var(--gift-steel-light)" />
      {/* herbs on the board */}
      <path d="M40 78 C46 70 54 72 52 80 C48 84 42 84 40 78 Z" fill="var(--gift-leaf)" />
      <path d="M41 79 L52 75" stroke="var(--gift-leaf-dark)" strokeWidth="1" />
      <path d="M56 84 C60 76 68 78 67 85 C64 89 58 89 56 84 Z" fill="var(--gift-leaf-light)" />
      <circle cx="72" cy="80" r="3.4" fill="var(--gift-rose)" />
      <circle cx="78" cy="83" r="2.6" fill="var(--gift-rose)" />
    </Canvas>
  )
}

export function SpicesArt() {
  const jar = (x: number, fill: string, tilt = 0) => (
    <g transform={`rotate(${tilt} ${x + 13} 98)`}>
      <rect x={x} y="48" width="26" height="50" rx="7" fill="var(--gift-sky-light)" opacity=".85" />
      <rect x={x + 2.5} y="64" width="21" height="31.5" rx="5" fill={fill} />
      <rect x={x + 4} y="52" width="4" height="40" rx="2" fill="var(--surface)" opacity=".55" />
      <rect x={x - 1} y="38" width="28" height="12" rx="4" fill="var(--gift-wood-light)" />
      <rect x={x - 1} y="38" width="28" height="4" rx="2" fill="var(--gift-wood)" opacity=".5" />
      <rect x={x + 5} y="70" width="16" height="10" rx="2" fill="var(--gift-cream)" />
    </g>
  )
  return (
    <Canvas label="spices">
      <Floor rx={42} />
      {jar(16, 'var(--gift-clay)', -4)}
      {jar(47, 'var(--gift-butter-dark)')}
      {jar(78, 'var(--gift-leaf)', 4)}
      {/* a star anise and peppercorns in front */}
      <path d="M58 104 l3 -6 l3 6 l6 -2 l-3 5 l3 5 l-6 -1 l-3 5 l-3 -5 l-6 1 l3 -5 l-3 -5 z" fill="var(--gift-wood-dark)" opacity=".85" />
      <circle cx="42" cy="104" r="2" fill="var(--gift-charcoal)" />
      <circle cx="47" cy="106" r="1.7" fill="var(--gift-charcoal)" />
      <circle cx="80" cy="105" r="1.8" fill="var(--gift-charcoal)" />
    </Canvas>
  )
}

export function TongsArt() {
  return (
    <Canvas label="tongs">
      <Floor rx={36} />
      {/* the spatula */}
      <g transform="rotate(-24 60 64)">
        <rect x="56" y="58" width="8" height="40" rx="4" fill="var(--gift-wood-dark)" />
        <rect x="58.5" y="38" width="3" height="22" fill="var(--gift-steel-dark)" />
        <rect x="46" y="12" width="28" height="28" rx="5" fill="var(--gift-steel-light)" />
        <rect x="52" y="17" width="3" height="16" rx="1.5" fill="var(--gift-steel-dark)" opacity=".5" />
        <rect x="58.5" y="17" width="3" height="16" rx="1.5" fill="var(--gift-steel-dark)" opacity=".5" />
        <rect x="65" y="17" width="3" height="16" rx="1.5" fill="var(--gift-steel-dark)" opacity=".5" />
      </g>
      {/* the tongs */}
      <g transform="rotate(22 60 64)">
        <path d="M56 98 L50 26 C49 22 53 20 54 24 L60 92 Z" fill="var(--gift-steel)" />
        <path d="M64 98 L70 26 C71 22 67 20 66 24 L60 92 Z" fill="var(--gift-steel-dark)" />
        <rect x="53" y="76" width="14" height="24" rx="5" fill="var(--accent-500)" />
        <circle cx="60" cy="104" r="4.5" fill="none" stroke="var(--gift-steel-dark)" strokeWidth="2.4" />
      </g>
      <Sparkle x={24} y={30} r={4} />
      <Sparkle x={98} y={34} r={3} opacity={0.7} />
    </Canvas>
  )
}

export function PopcornArt() {
  return (
    <Canvas label="popcorn">
      <Floor rx={36} />
      {/* the ticket */}
      <g transform="rotate(-14 90 84)">
        <rect x="70" y="74" width="40" height="20" rx="3" fill="var(--gift-butter)" />
        <path d="M80 74 V94" stroke="var(--gift-butter-dark)" strokeWidth="1.4" strokeDasharray="2 2.4" />
        <rect x="85" y="80" width="18" height="3" rx="1.5" fill="var(--gift-butter-dark)" />
        <rect x="85" y="86" width="12" height="3" rx="1.5" fill="var(--gift-butter-dark)" opacity=".7" />
      </g>
      {/* popcorn puffs over the rim */}
      {[
        [40, 44, 8], [52, 36, 9], [64, 38, 8.5], [76, 44, 8], [46, 30, 6.5], [60, 28, 7], [70, 31, 6], [34, 50, 6], [84, 50, 6],
      ].map(([cx, cy, r]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={r} fill="var(--gift-cream)" />
          <circle cx={(cx ?? 0) + 2} cy={(cy ?? 0) + 2} r={(r ?? 0) * 0.45} fill="var(--gift-butter)" opacity=".7" />
        </g>
      ))}
      {/* the striped box */}
      <path d="M30 50 H90 L82 102 H38 Z" fill="var(--surface)" />
      <path d="M38 50 H46 L45 102 H40 Z" fill="var(--gift-rose-dark)" />
      <path d="M54 50 H62 L61.5 102 H55.5 Z" fill="var(--gift-rose-dark)" />
      <path d="M70 50 H78 L75.8 102 H70.5 Z" fill="var(--gift-rose-dark)" />
      <path d="M30 50 H90 L89.2 56 H30.8 Z" fill="var(--gift-rose)" />
    </Canvas>
  )
}

export function ThermosArt() {
  return (
    <Canvas label="thermos">
      <Floor rx={24} />
      {/* the cup-lid beside it */}
      <path d="M78 84 H100 L97 102 H81 Z" fill="var(--gift-charcoal)" />
      <path d="M80 84 H98 L97.6 87 H80.4 Z" fill="var(--gift-steel-dark)" />
      <path d="M86 78 C83 74 89 72 86 68" stroke="var(--text-3)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".4" />
      {/* the flask */}
      <rect x="38" y="30" width="36" height="72" rx="13" fill="var(--gift-leaf)" />
      <rect x="62" y="30" width="12" height="72" rx="6" fill="var(--gift-leaf-dark)" opacity=".45" />
      <rect x="44" y="38" width="6" height="56" rx="3" fill="var(--surface)" opacity=".35" />
      <rect x="38" y="82" width="36" height="7" fill="var(--gift-leaf-dark)" opacity=".65" />
      <rect x="41" y="18" width="30" height="16" rx="5" fill="var(--gift-charcoal)" />
      <rect x="41" y="18" width="30" height="4" rx="2" fill="var(--gift-steel-dark)" />
      <Sparkle x={24} y={44} r={4.2} />
    </Canvas>
  )
}

export function BottleArt() {
  return (
    <Canvas label="bottle">
      <Floor rx={22} />
      <path d="M53 18 C53 8 67 8 67 18" stroke="var(--accent-400)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="49" y="16" width="22" height="11" rx="4.5" fill="var(--accent-400)" />
      <rect x="51" y="26" width="18" height="8" rx="2" fill="var(--gift-steel-dark)" />
      <rect x="42" y="32" width="36" height="70" rx="13" fill="var(--gift-steel)" />
      <rect x="66" y="32" width="12" height="70" rx="6" fill="var(--gift-steel-dark)" opacity=".4" />
      <rect x="47" y="40" width="6" height="54" rx="3" fill="var(--surface)" opacity=".6" />
      <rect x="42" y="58" width="36" height="18" fill="var(--accent-300)" />
      <path d="M50 67 H70" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
      <Sparkle x={92} y={40} r={4.2} />
    </Canvas>
  )
}
