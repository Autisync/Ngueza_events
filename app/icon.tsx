import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// Generated at build time rather than a checked-in PNG — one wordmark,
// no image-editing round trip for a colour tweak. Blue and white only,
// per CLAUDE.md.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b4f8f',
          borderRadius: 96,
        }}
      >
        <span
          style={{
            fontSize: 300,
            fontWeight: 700,
            color: '#ffffff',
            fontFamily: 'sans-serif',
          }}
        >
          N
        </span>
      </div>
    ),
    { ...size },
  )
}
