import { useMemo } from 'react'
import { encodeQr, qrPath } from './encode'

// The QR of "Mein Code" as one inline SVG (add-friends-design §2.1): drawn on the device by our own encoder, nothing
// is loaded from anywhere. Always dark on white with a 4-module quiet zone — also in the dark theme — so every
// phone camera reads it. A lazy chunk: only the QR tab of the follow sheet loads it.

export interface QrImageProps {
  /** what the QR carries (the friend code's /f URL) */
  value: string
  /** accessible name (from i18n) */
  label: string
  /** CSS size of the square, px */
  size?: number
}

export default function QrImage({ value, label, size = 208 }: QrImageProps) {
  const { matrix, path } = useMemo(() => {
    const encoded = encodeQr(value)
    return { matrix: encoded, path: qrPath(encoded) }
  }, [value])
  const side = matrix.size + 8
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" className="pp-qr">
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
