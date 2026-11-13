import type { ReactNode } from 'react'
import type { OAuthProvider } from '../../lib/api/auth'
import googleLogo from './assets/google-g.svg'
import appleLogo from './assets/apple-black.svg'

/**
 * Local official artwork; provenance and the preserved Apple padding are in assets/README.md.
 * Both provider buttons are white with a thin border (blocker 14): Google's light button (#FFFFFF, stroke
 * #747775, text #1F1F1F — its branding guidelines) and Apple's white style with a black border (HIG: on light
 * backgrounds; black logo, text and border). They stay opaque on every surface, also on the start screen's
 * glass card: provider buttons keep their own colours. The colours are the providers' brand values. In the dark
 * theme Google's own dark button (#131314, stroke #8E918F, text #E3E3E3); Apple's white style is the one Apple
 * recommends on dark backgrounds anyway.
 * (No bare utility names in comments here: Tailwind scans this file and would generate them.)
 */
export function socialProviderClass(provider: OAuthProvider): string {
  const common = 'relative border px-14!'
  return provider === 'google'
    ? `${common} border-[color:light-dark(#747775,#8E918F)] bg-[color:light-dark(#FFFFFF,#131314)]! text-[color:light-dark(#1F1F1F,#E3E3E3)]! hover:bg-[color:light-dark(#F8FAFC,#1E1F20)]! active:bg-[color:light-dark(#F1F3F4,#2A2B2D)]!`
    : `${common} border-[#000000] bg-white! text-[#1F1F1F]! hover:bg-[#F8FAFC]! active:bg-[#F1F3F4]!`
}

export function SocialProviderContent({ provider, children }: { provider: OAuthProvider; children: ReactNode }) {
  return <>
    <img src={provider === 'google' ? googleLogo : appleLogo} alt="" aria-hidden="true"
      className={provider === 'google' ? 'absolute left-5 size-5 shrink-0' : 'absolute left-3 h-13 w-auto shrink-0'} />
    {/* at 320 px "Mit Google fortfahren" / "Продолжить с Google" is wider than the room between the logo
        paddings: it breaks into two balanced lines inside the 52 px button instead of running under the logo */}
    <span className="block min-w-0 flex-1 whitespace-normal text-center leading-tight text-balance">{children}</span>
  </>
}
