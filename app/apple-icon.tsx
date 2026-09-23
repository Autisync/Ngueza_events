import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// iOS ignores manifest icons and wants its own apple-touch-icon, without
// a transparent background or rounded corners — Springboard applies its
// own mask.
export default function AppleIcon() {
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
        }}
      >
        <span
          style={{
            fontSize: 108,
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
