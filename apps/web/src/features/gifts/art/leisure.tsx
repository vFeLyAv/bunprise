import { Canvas, Floor, Sparkle } from './kit'

// Demo drawings: sound, books, games, photo, music, crafts, fashion, sport, outdoors, tech.
// Own flat drawings, token colours only.

export function HeadphonesArt() {
  return (
    <Canvas label="headphones">
      <Floor rx={38} />
      {/* the band */}
      <path d="M24 70 C24 36 42 20 60 20 C78 20 96 36 96 70" stroke="var(--gift-charcoal)" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M42 26 C54 19 66 19 78 26" stroke="var(--accent-300)" strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M46 25 C55 21 63 21 70 23" stroke="var(--surface)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6" />
      {/* left cup */}
      <rect x="12" y="56" width="26" height="44" rx="13" fill="var(--accent-400)" />
      <rect x="30" y="61" width="14" height="34" rx="7" fill="var(--gift-charcoal)" />
      <rect x="16" y="62" width="6" height="26" rx="3" fill="var(--surface)" opacity=".35" />
      {/* right cup */}
      <rect x="82" y="56" width="26" height="44" rx="13" fill="var(--accent-400)" />
      <rect x="76" y="61" width="14" height="34" rx="7" fill="var(--gift-charcoal)" />
      <rect x="98" y="62" width="6" height="26" rx="3" fill="var(--accent-600)" opacity=".25" />
      {/* music notes */}
      <path d="M58 46 V34 L68 31 V43" stroke="var(--accent-500)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="55.6" cy="46.5" rx="3.4" ry="2.6" fill="var(--accent-500)" />
      <ellipse cx="65.6" cy="43.5" rx="3.4" ry="2.6" fill="var(--accent-500)" />
    </Canvas>
  )
}

export function SpeakerArt() {
  const dots: Array<[number, number]> = []
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 9; col += 1) dots.push([28 + col * 8, 52 + row * 8])
  return (
    <Canvas label="speaker">
      <Floor rx={40} />
      <path d="M36 44 C36 28 84 28 84 44" stroke="var(--gift-charcoal)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="18" y="42" width="84" height="58" rx="20" fill="var(--gift-sky)" />
      <rect x="18" y="82" width="84" height="18" rx="9" fill="var(--gift-sky-dark)" opacity=".35" />
      {dots.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="var(--gift-sky-dark)" opacity=".55" />
      ))}
      <circle cx="60" cy="74" r="13" fill="var(--gift-sky-dark)" />
      <circle cx="60" cy="74" r="7" fill="var(--gift-sky)" />
      <circle cx="60" cy="74" r="2.6" fill="var(--gift-sky-dark)" />
      <rect x="24" y="46" width="24" height="4" rx="2" fill="var(--surface)" opacity=".5" />
      <rect x="72" y="36" width="8" height="5" rx="2" fill="var(--accent-400)" />
      <rect x="84" y="37" width="6" height="4" rx="2" fill="var(--gift-steel-light)" />
      <path d="M106 54 a10 10 0 0 1 0 16" stroke="var(--gift-sky-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".6" />
      <path d="M112 48 a18 18 0 0 1 0 28" stroke="var(--gift-sky-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".35" />
    </Canvas>
  )
}

export function BooksArt() {
  const spine = (x: number, y: number, w: number, h: number, fill: string, band: string) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={fill} />
      <rect x={x + 6} y={y + h / 2 - 2.5} width={w - 12} height="5" rx="2" fill={band} opacity=".85" />
      <rect x={x + w - 10} y={y + 3} width="3" height={h - 6} rx="1.5" fill="var(--surface)" opacity=".25" />
    </g>
  )
  return (
    <Canvas label="books">
      <Floor rx={40} />
      {spine(20, 80, 80, 20, 'var(--gift-sky-dark)', 'var(--gift-butter)')}
      {spine(28, 62, 68, 18, 'var(--gift-clay)', 'var(--gift-cream)')}
      {spine(22, 44, 74, 18, 'var(--gift-leaf)', 'var(--gift-cream)')}
      {/* a little cup on top */}
      <rect x="66" y="28" width="20" height="16" rx="5" fill="var(--gift-cream)" />
      <path d="M86 32 C92 32 92 40 86 40" stroke="var(--gift-cream)" strokeWidth="3" fill="none" />
      <path d="M72 24 C70 20 75 18 73 14" stroke="var(--text-3)" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity=".45" />
      <Sparkle x={30} y={30} r={4.2} />
    </Canvas>
  )
}

export function OpenBookArt() {
  return (
    <Canvas label="openbook">
      <Floor rx={44} />
      {/* the cover under the pages */}
      <path d="M12 44 V92 C30 86 46 88 60 96 C74 88 90 86 108 92 V44 Z" fill="var(--accent-500)" />
      {/* pages */}
      <path d="M60 40 C46 32 30 32 16 38 V88 C30 82 46 84 60 92 Z" fill="var(--surface)" />
      <path d="M60 40 C74 32 90 32 104 38 V88 C90 82 74 84 60 92 Z" fill="var(--gift-cream)" />
      <path d="M60 40 V92" stroke="var(--separator)" strokeWidth="1.4" />
      {[48, 56, 64, 72].map((y) => (
        <path key={`l${y}`} d={`M24 ${y} C34 ${y - 3} 44 ${y - 2} 52 ${y + 1}`} stroke="var(--text-3)" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".35" />
      ))}
      {[48, 56, 64].map((y) => (
        <path key={`r${y}`} d={`M68 ${y + 1} C76 ${y - 2} 86 ${y - 3} 96 ${y}`} stroke="var(--text-3)" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".35" />
      ))}
      {/* brass bookmarks */}
      <path d="M78 30 V58 L82 54 L86 58 V30 Z" fill="var(--gift-butter-dark)" />
      <path d="M88 32 V52 L91 49 L94 52 V32 Z" fill="var(--gift-butter)" />
      <circle cx="82" cy="30" r="3" fill="var(--gift-butter-dark)" />
      <Sparkle x={22} y={24} r={4.2} fill="var(--gift-butter)" opacity={1} />
    </Canvas>
  )
}

export function AlbumArt() {
  return (
    <Canvas label="album">
      <Floor rx={42} />
      <rect x="16" y="40" width="88" height="60" rx="7" fill="var(--gift-sky)" />
      <rect x="16" y="40" width="12" height="60" rx="6" fill="var(--gift-sky-dark)" opacity=".7" />
      {[48, 56, 64, 72, 80, 88].map((y) => (
        <path key={y} d={`M32 ${y} H100`} stroke="var(--surface)" strokeWidth="1" opacity=".18" />
      ))}
      {/* the photo in the cover window */}
      <rect x="44" y="52" width="44" height="34" rx="3" fill="var(--surface)" />
      <rect x="48" y="56" width="36" height="22" rx="1.5" fill="var(--gift-sky-light)" />
      <path d="M48 78 L60 66 L68 72 L74 66 L84 76 V78 Z" fill="var(--gift-leaf)" />
      <circle cx="76" cy="62" r="3.4" fill="var(--gift-butter)" />
      {/* the elastic band */}
      <rect x="94" y="40" width="4" height="60" fill="var(--gift-charcoal)" opacity=".7" />
      <Sparkle x={24} y={28} r={4.2} />
    </Canvas>
  )
}

export function ControllerArt() {
  return (
    <Canvas label="controller">
      <Floor rx={42} />
      <path d="M32 48 C20 48 12 60 14 76 C16 92 26 100 36 96 C44 93 46 84 52 82 H68 C74 84 76 93 84 96 C94 100 104 92 106 76 C108 60 100 48 88 48 Z" fill="var(--gift-sky-dark)" />
      <path d="M32 48 C22 48 16 56 15 66 C22 56 30 54 40 54 H80 C90 54 98 56 105 66 C104 56 98 48 88 48 Z" fill="var(--surface)" opacity=".18" />
      {/* d-pad */}
      <path d="M30 62 h6 v-6 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 z" fill="var(--gift-charcoal)" />
      {/* buttons */}
      <circle cx="86" cy="58" r="4.2" fill="var(--gift-butter)" />
      <circle cx="94" cy="66" r="4.2" fill="var(--gift-rose)" />
      <circle cx="78" cy="66" r="4.2" fill="var(--gift-leaf-light)" />
      <circle cx="86" cy="74" r="4.2" fill="var(--accent-400)" />
      {/* sticks */}
      <circle cx="48" cy="80" r="7" fill="var(--gift-charcoal)" />
      <circle cx="48" cy="80" r="4" fill="var(--gift-steel-dark)" />
      <circle cx="72" cy="80" r="7" fill="var(--gift-charcoal)" />
      <circle cx="72" cy="80" r="4" fill="var(--gift-steel-dark)" />
      <rect x="56" y="58" width="8" height="4" rx="2" fill="var(--surface)" opacity=".6" />
      <Sparkle x={100} y={32} r={4.2} />
    </Canvas>
  )
}

export function BoardgameArt() {
  return (
    <Canvas label="boardgame">
      <Floor rx={44} />
      {/* the box: top, front, side */}
      <path d="M14 54 L30 40 H102 L86 54 Z" fill="var(--accent-300)" />
      <path d="M86 54 L102 40 V82 L86 96 Z" fill="var(--accent-600)" opacity=".55" />
      <rect x="14" y="54" width="72" height="42" rx="3" fill="var(--accent-400)" />
      <path d="M40 46 L48 40 H62 L54 46 Z" fill="var(--surface)" opacity=".4" />
      {/* the board printed on the front */}
      <circle cx="50" cy="75" r="13" fill="var(--gift-cream)" />
      <path d="M50 64 L53 72 L61 72 L55 77 L57 85 L50 80 L43 85 L45 77 L39 72 L47 72 Z" fill="var(--accent-500)" />
      {/* a die and a figure in front */}
      <g transform="rotate(-12 26 100)">
        <rect x="16" y="88" width="18" height="18" rx="4" fill="var(--surface)" />
        <circle cx="21" cy="93" r="1.8" fill="var(--gift-charcoal)" />
        <circle cx="25" cy="97" r="1.8" fill="var(--gift-charcoal)" />
        <circle cx="29" cy="101" r="1.8" fill="var(--gift-charcoal)" />
      </g>
      <path d="M98 104 C98 98 100 96 103 95 C100 93 99 90 101 87.5 C103 85 107 85 109 87.5 C111 90 110 93 107 95 C110 96 112 98 112 104 Z" fill="var(--gift-leaf)" />
    </Canvas>
  )
}

export function PuzzleArt() {
  const piece = 'M0 0 H13 C13 -7 27 -7 27 0 H40 V13 C47 13 47 27 40 27 V40 H27 C27 33 13 33 13 40 H0 V27 C7 27 7 13 0 13 Z'
  return (
    <Canvas label="puzzle">
      <Floor rx={40} />
      <g transform="translate(18 50) rotate(-10)">
        <path d={piece} fill="var(--gift-clay)" />
        <path d="M5 5 H11" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
      </g>
      <g transform="translate(60 46) rotate(12)">
        <path d={piece} fill="var(--gift-sky)" />
        <path d="M5 5 H11" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
      </g>
      <g transform="translate(38 20) rotate(4)">
        <path d={piece} fill="var(--gift-butter)" />
        <path d="M5 5 H11" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
      </g>
      <Sparkle x={100} y={30} r={4.4} />
    </Canvas>
  )
}

export function CardsArt() {
  const card = (angle: number, symbol: 'heart' | 'club' | 'star', color: string) => (
    <g transform={`rotate(${angle} 60 100)`}>
      <rect x="40" y="30" width="40" height="58" rx="6" fill="var(--surface)" />
      <rect x="40" y="30" width="40" height="58" rx="6" fill="none" stroke="var(--separator)" strokeWidth="1.2" />
      {symbol === 'heart' ? (
        <path d="M60 70 C50 63 46 58 46 53 C46 48 52 45 56 48 C58 49.5 59 51 60 52.5 C61 51 62 49.5 64 48 C68 45 74 48 74 53 C74 58 70 63 60 70 Z" fill={color} />
      ) : symbol === 'club' ? (
        <g fill={color}>
          <circle cx="60" cy="50" r="6" />
          <circle cx="53" cy="59" r="6" />
          <circle cx="67" cy="59" r="6" />
          <path d="M58 58 H62 L64 70 H56 Z" />
        </g>
      ) : (
        <path d="M60 44 L64 54 L75 54 L66 61 L69 72 L60 65 L51 72 L54 61 L45 54 L56 54 Z" fill={color} />
      )}
      <circle cx="47" cy="37" r="2.4" fill={color} />
      <circle cx="73" cy="81" r="2.4" fill={color} />
    </g>
  )
  return (
    <Canvas label="cards">
      <Floor rx={36} />
      {card(-18, 'club', 'var(--gift-sky-dark)')}
      {card(0, 'star', 'var(--accent-500)')}
      {card(18, 'heart', 'var(--gift-rose-dark)')}
    </Canvas>
  )
}

export function CameraArt() {
  return (
    <Canvas label="camera">
      <Floor rx={40} />
      {/* the photo coming out */}
      <rect x="38" y="16" width="44" height="30" rx="2" fill="var(--surface)" />
      <rect x="42" y="20" width="36" height="20" rx="1" fill="var(--gift-sky-light)" />
      <path d="M42 40 L54 30 L62 36 L68 31 L78 39 V40 Z" fill="var(--gift-leaf)" />
      <circle cx="70" cy="25" r="3" fill="var(--gift-butter)" />
      {/* the body */}
      <rect x="18" y="38" width="84" height="62" rx="14" fill="var(--gift-cream)" />
      <rect x="18" y="38" width="84" height="18" rx="9" fill="var(--surface)" />
      <rect x="18" y="84" width="84" height="16" rx="8" fill="var(--gift-wood-light)" opacity=".5" />
      {/* the colour stripe */}
      <rect x="28" y="62" width="5" height="26" rx="2.5" fill="var(--accent-400)" />
      <rect x="34" y="62" width="5" height="26" rx="2.5" fill="var(--gift-butter-dark)" />
      <rect x="40" y="62" width="5" height="26" rx="2.5" fill="var(--gift-leaf)" />
      {/* lens */}
      <circle cx="66" cy="72" r="19" fill="var(--gift-charcoal)" />
      <circle cx="66" cy="72" r="13" fill="var(--gift-steel-dark)" />
      <circle cx="66" cy="72" r="8" fill="var(--gift-sky-dark)" />
      <circle cx="62" cy="68" r="3" fill="var(--surface)" opacity=".75" />
      {/* flash and viewfinder */}
      <rect x="82" y="43" width="14" height="9" rx="2.5" fill="var(--gift-steel-light)" />
      <rect x="26" y="44" width="10" height="7" rx="2" fill="var(--gift-charcoal)" opacity=".8" />
      <circle cx="94" cy="62" r="3" fill="var(--accent-500)" />
    </Canvas>
  )
}

export function VinylArt() {
  return (
    <Canvas label="vinyl">
      <Floor rx={42} />
      {/* the record, half out of its sleeve */}
      <circle cx="74" cy="62" r="32" fill="var(--gift-charcoal)" />
      {[26, 21, 16].map((r) => (
        <circle key={r} cx="74" cy="62" r={r} fill="none" stroke="var(--gift-steel-dark)" strokeWidth="0.9" opacity=".6" />
      ))}
      <path d="M90 40 A27 27 0 0 1 100 56" stroke="var(--surface)" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".35" />
      <circle cx="74" cy="62" r="10" fill="var(--accent-400)" />
      <circle cx="74" cy="62" r="1.8" fill="var(--surface)" />
      {/* the sleeve */}
      <rect x="14" y="30" width="62" height="64" rx="4" fill="var(--gift-rose-dark)" />
      <circle cx="45" cy="58" r="17" fill="var(--gift-rose)" />
      <circle cx="45" cy="58" r="10" fill="var(--gift-butter)" />
      <path d="M22 84 H54" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" opacity=".75" />
      <path d="M22 89 H40" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <rect x="14" y="30" width="7" height="64" rx="3.5" fill="var(--surface)" opacity=".18" />
    </Canvas>
  )
}

export function UkuleleArt() {
  return (
    <Canvas label="ukulele">
      <Floor rx={36} />
      <g transform="rotate(-36 60 64)">
        {/* neck and head */}
        <rect x="55" y="6" width="10" height="56" rx="3" fill="var(--gift-wood-dark)" />
        <rect x="52" y="0" width="16" height="16" rx="4" fill="var(--gift-wood)" />
        <circle cx="54" cy="5" r="1.8" fill="var(--gift-steel-light)" />
        <circle cx="66" cy="5" r="1.8" fill="var(--gift-steel-light)" />
        <circle cx="54" cy="11" r="1.8" fill="var(--gift-steel-light)" />
        <circle cx="66" cy="11" r="1.8" fill="var(--gift-steel-light)" />
        {/* body: two rounds */}
        <circle cx="60" cy="66" r="16" fill="var(--gift-wood-light)" />
        <circle cx="60" cy="92" r="21" fill="var(--gift-wood-light)" />
        <path d="M44 92 A16 16 0 0 0 76 96 A21 21 0 0 1 44 92 Z" fill="var(--gift-wood)" opacity=".45" />
        <circle cx="60" cy="74" r="6.5" fill="var(--gift-wood-dark)" />
        <rect x="52" y="96" width="16" height="4" rx="2" fill="var(--gift-wood-dark)" />
        {[57.2, 59.1, 60.9, 62.8].map((x) => (
          <path key={x} d={`M${x} 8 V98`} stroke="var(--surface)" strokeWidth="0.7" opacity=".85" />
        ))}
      </g>
      <Sparkle x={26} y={40} r={4.2} />
    </Canvas>
  )
}

export function PaintsArt() {
  const pans = ['var(--gift-rose-dark)', 'var(--accent-400)', 'var(--gift-butter-dark)', 'var(--gift-leaf)', 'var(--gift-sky-dark)', 'var(--gift-clay)', 'var(--gift-rose)', 'var(--gift-butter)', 'var(--gift-leaf-light)', 'var(--gift-sky)']
  return (
    <Canvas label="paints">
      <Floor rx={44} />
      <rect x="12" y="58" width="80" height="40" rx="7" fill="var(--surface)" />
      <rect x="12" y="90" width="80" height="8" rx="4" fill="var(--gift-steel)" opacity=".6" />
      {pans.map((fill, i) => (
        <rect key={fill} x={18 + (i % 5) * 14.6} y={i < 5 ? 63 : 77} width="11" height="10" rx="3" fill={fill} />
      ))}
      {/* the brush */}
      <g transform="rotate(32 92 60)">
        <rect x="88" y="20" width="7" height="50" rx="3.5" fill="var(--gift-wood-dark)" />
        <rect x="88" y="66" width="7" height="10" fill="var(--gift-steel)" />
        <path d="M88 76 H95 C95 84 92.5 90 91.5 92 C90.5 90 88 84 88 76 Z" fill="var(--gift-charcoal)" />
        <path d="M89.5 84 C90 88 91 90.5 91.5 92 C92 90.5 93 88 93.5 84 Z" fill="var(--gift-sky-dark)" />
      </g>
      <circle cx="104" cy="98" r="3.4" fill="var(--gift-sky)" opacity=".8" />
      <circle cx="96" cy="104" r="2.2" fill="var(--gift-rose)" opacity=".8" />
    </Canvas>
  )
}

export function YarnArt() {
  return (
    <Canvas label="yarn">
      <Floor rx={40} />
      {/* the needles */}
      <path d="M70 22 L98 98" stroke="var(--gift-wood)" strokeWidth="4" strokeLinecap="round" />
      <path d="M100 26 L70 100" stroke="var(--gift-wood)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="69" cy="20" r="4" fill="var(--gift-wood-dark)" />
      <circle cx="101" cy="24" r="4" fill="var(--gift-wood-dark)" />
      {/* the ball */}
      <circle cx="48" cy="72" r="30" fill="var(--gift-rose)" />
      <path d="M22 60 C36 70 56 66 74 56" stroke="var(--gift-rose-dark)" strokeWidth="2.4" fill="none" opacity=".55" />
      <path d="M20 74 C38 84 60 80 78 70" stroke="var(--gift-rose-dark)" strokeWidth="2.4" fill="none" opacity=".55" />
      <path d="M28 92 C40 70 52 56 70 48" stroke="var(--gift-rose-dark)" strokeWidth="2.4" fill="none" opacity=".45" />
      <path d="M40 100 C48 80 62 66 76 62" stroke="var(--gift-rose-dark)" strokeWidth="2.4" fill="none" opacity=".45" />
      <ellipse cx="38" cy="58" rx="8" ry="5" fill="var(--surface)" opacity=".35" transform="rotate(-30 38 58)" />
      {/* the loose end */}
      <path d="M74 84 C86 88 84 100 96 102 C104 103 108 98 112 100" stroke="var(--gift-rose)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </Canvas>
  )
}

export function ScarfArt() {
  return (
    <Canvas label="scarf">
      <Floor rx={34} />
      {/* the loop around an invisible neck */}
      <path d="M36 34 C36 18 84 18 84 34" stroke="var(--accent-400)" strokeWidth="14" fill="none" strokeLinecap="round" />
      {/* the two hanging ends */}
      <path d="M30 32 H54 L56 92 H32 Z" fill="var(--accent-400)" />
      <path d="M62 34 H86 L80 90 H58 Z" fill="var(--accent-500)" />
      {[44, 56, 68, 80].map((y) => (
        <path key={`a${y}`} d={`M34 ${y} L38 ${y + 4} L42 ${y} M42 ${y} L46 ${y + 4} L50 ${y}`} stroke="var(--accent-600)" strokeWidth="1.6" fill="none" opacity=".35" strokeLinejoin="round" />
      ))}
      {[44, 56, 68, 78].map((y) => (
        <path key={`b${y}`} d={`M64 ${y} L68 ${y + 4} L72 ${y} M72 ${y} L76 ${y + 4} L80 ${y}`} stroke="var(--accent-700)" strokeWidth="1.6" fill="none" opacity=".3" strokeLinejoin="round" />
      ))}
      <rect x="30" y="62" width="25" height="5" fill="var(--gift-cream)" opacity=".85" />
      <rect x="59.5" y="62" width="24" height="5" fill="var(--gift-cream)" opacity=".85" transform="rotate(-2 70 64)" />
      {/* fringes */}
      {[34, 39, 44, 49, 54].map((x) => (
        <path key={`f${x}`} d={`M${x} 92 V102`} stroke="var(--accent-400)" strokeWidth="2.6" strokeLinecap="round" />
      ))}
      {[60, 65, 70, 75, 80].map((x, i) => (
        <path key={`g${x}`} d={`M${x} 90 L${x - 1 + i * 0.2} 100`} stroke="var(--accent-500)" strokeWidth="2.6" strokeLinecap="round" />
      ))}
    </Canvas>
  )
}

export function ToteArt() {
  return (
    <Canvas label="tote">
      <Floor rx={34} />
      <path d="M42 48 C42 22 58 22 58 48" stroke="var(--gift-wood)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M62 48 C62 22 78 22 78 48" stroke="var(--gift-wood)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M26 46 H94 L90 102 H30 Z" fill="var(--gift-wood-light)" />
      <path d="M78 46 H94 L90 102 H76 Z" fill="var(--gift-wood)" opacity=".3" />
      {[54, 62, 70, 78, 86, 94].map((y) => (
        <path key={y} d={`M${28 + (y - 46) * 0.06} ${y} H${92 - (y - 46) * 0.06}`} stroke="var(--gift-wood)" strokeWidth="0.8" opacity=".3" />
      ))}
      {/* the embroidered flower */}
      <path d="M60 86 C58 78 60 72 60 70" stroke="var(--gift-leaf-dark)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M60 80 C54 78 52 74 54 72 C57 72 60 76 60 80 Z" fill="var(--gift-leaf)" />
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx="60" cy="62" rx="4" ry="6.5" fill="var(--gift-rose)" transform={`rotate(${angle} 60 66) translate(0 -2)`} />
      ))}
      <circle cx="60" cy="66" r="3.6" fill="var(--gift-butter)" />
    </Canvas>
  )
}

export function YogaArt() {
  return (
    <Canvas label="yoga">
      <Floor rx={42} />
      <rect x="14" y="58" width="78" height="38" rx="19" fill="var(--gift-wood-light)" />
      <rect x="14" y="58" width="78" height="10" rx="5" fill="var(--surface)" opacity=".25" />
      <circle cx="92" cy="77" r="19" fill="var(--gift-wood)" />
      <path d="M92 77 m-3 0 a3 3 0 1 1 6 0 a6 6 0 1 1 -12 0 a9 9 0 1 1 18 0 a12 12 0 1 1 -24 0 a15 15 0 1 1 30 0" stroke="var(--gift-wood-dark)" strokeWidth="1.6" fill="none" opacity=".55" />
      {/* the straps */}
      <rect x="32" y="55" width="7" height="44" rx="2.5" fill="var(--gift-leaf)" />
      <rect x="64" y="55" width="7" height="44" rx="2.5" fill="var(--gift-leaf)" />
      {/* cork speckles */}
      {[[24, 74], [46, 84], [52, 70], [78, 88], [84, 66]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="var(--gift-wood-dark)" opacity=".5" />
      ))}
      <Sparkle x={28} y={38} r={4.4} />
      <Sparkle x={96} y={36} r={3} opacity={0.7} />
    </Canvas>
  )
}

export function LanternArt() {
  return (
    <Canvas label="lantern">
      <Floor rx={28} />
      <circle cx="60" cy="62" r="36" fill="var(--gift-butter)" opacity=".25" />
      <path d="M46 30 C46 14 74 14 74 30" stroke="var(--gift-charcoal)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="38" y="28" width="44" height="12" rx="5" fill="var(--gift-leaf-dark)" />
      <rect x="42" y="40" width="36" height="44" rx="11" fill="var(--gift-butter)" />
      <ellipse cx="60" cy="62" rx="9" ry="14" fill="var(--surface)" opacity=".8" />
      <path d="M51 42 V82 M69 42 V82" stroke="var(--gift-leaf-dark)" strokeWidth="2.4" opacity=".7" />
      <rect x="36" y="82" width="48" height="20" rx="6" fill="var(--gift-leaf)" />
      <rect x="36" y="82" width="48" height="5" rx="2.5" fill="var(--surface)" opacity=".25" />
      <circle cx="74" cy="92" r="3" fill="var(--gift-butter)" />
    </Canvas>
  )
}

export function PowerbankArt() {
  return (
    <Canvas label="powerbank">
      <Floor rx={34} />
      {/* the cable */}
      <path d="M76 82 C92 82 98 94 88 100 C80 104 72 96 78 90 C86 84 100 88 104 74" stroke="var(--gift-steel-dark)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="100" y="62" width="8" height="14" rx="2" fill="var(--gift-steel-dark)" />
      {/* the body */}
      <rect x="28" y="30" width="50" height="72" rx="12" fill="var(--gift-sky-dark)" />
      <rect x="32" y="34" width="42" height="64" rx="9" fill="var(--gift-sky)" />
      <rect x="36" y="38" width="6" height="52" rx="3" fill="var(--surface)" opacity=".3" />
      {/* charge level */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={45 + i * 7} y="84" width="5" height="5" rx="1.5" fill={i < 3 ? 'var(--gift-leaf-light)' : 'var(--surface)'} opacity={i < 3 ? 1 : 0.5} />
      ))}
      <path d="M56 48 L49 62 H56 L52 74 L63 58 H56 L60 48 Z" fill="var(--gift-butter)" />
    </Canvas>
  )
}
