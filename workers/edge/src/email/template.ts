// The invitation e-mail in the look of the sign-in code mail (supabase/templates/otp.html: paper colours, Pompon peeking
// over the card, dark mode, footer with Impressum / Datenschutz) — docs/spec/invite-email-design.md §0.
// E-mail rules as there: tables + inline styles (Outlook, Gmail), no scripts, no web fonts, no tracking of our own; the
// one picture is a static file of the app (the same for everybody: it says nothing about the reader).
// Neutral content only (messages.ts). The only per-mail part is the unsubscribe link with its one-time token.
import { MAIL, type MailLang } from './messages'

export interface InviteMail {
  subject: string
  html: string
  text: string
  /** RFC 8058 one-click target (List-Unsubscribe header) */
  unsubscribeUrl: string
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** HTML text / attribute escaping (every value is ours or validated; escaped anyway). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The address of the unsubscribe page / one-click target for a token (validated by the caller: 43 base64url chars). */
export function unsubscribeUrl(origin: string, token: string, lang: MailLang): string {
  return `${origin}/api/email/unsubscribe/${token}?l=${lang}`
}

export function inviteMail(lang: MailLang, origin: string, token: string): InviteMail {
  const w = MAIL[lang]
  const app = `${origin}/soon`
  const unsubscribe = unsubscribeUrl(origin, token, lang)
  const e = escapeHtml
  // the German mail ends with a short English paragraph (people whose app speaks Russian or Ukrainian read it too)
  const second = lang === 'de' ? MAIL.en : null
  const html = `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${e(w.subject)}</title>
  <style>
    @media (max-width: 520px) {
      .card { border-radius: 22px !important; }
      .pad { padding-left: 24px !important; padding-right: 24px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .page { background: #0B0B0E !important; }
      .card { background: #1C1C1E !important; border-color: #2C2C2E !important; }
      .text { color: #F5F5F7 !important; }
      .muted { color: #A1A1A6 !important; }
      .button { background: #F3B676 !important; color: #2A231C !important; }
      .rule { border-color: #2C2C2E !important; }
      .link { color: #F3B676 !important; }
    }
  </style>
</head>
<body class="page" style="margin:0;padding:0;background:#F2EBDD;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(w.preview)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:#F2EBDD;">
    <tr>
      <td align="center" style="padding:32px 12px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <tr>
            <td align="center" style="padding:0;line-height:0;font-size:0;">
              <img src="${e(origin)}/email/pompon-peek.png" width="220" height="180" alt="${e(w.pictureAlt)}"
                style="display:block;width:220px;height:auto;max-width:220px;border:0;outline:none;text-decoration:none;margin:0 auto -18px;color:#62554A;font:14px Arial,sans-serif;line-height:normal;">
            </td>
          </tr>
          <tr>
            <td class="card" style="background:#FFFDF8;border:1px solid #EADFCF;border-radius:28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="pad" align="center" style="padding:40px 40px 8px;font-family:${FONT};">
                    <p class="muted" style="margin:0 0 6px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#984A14;">Bunprise</p>
                    <h1 class="text" style="margin:0 0 10px;font-size:26px;line-height:32px;font-weight:700;color:#2A231C;">${e(w.heading)}</h1>
                    <p class="muted" style="margin:0 0 26px;font-size:16px;line-height:24px;color:#62554A;">${e(w.body)}</p>
                  </td>
                </tr>
                <tr>
                  <td class="pad" align="center" style="padding:0 40px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td class="button" align="center" style="background:#984A14;border-radius:999px;">
                          <a class="button" href="${e(app)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#FFFDF8;text-decoration:none;border-radius:999px;">${e(w.button)}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="pad" style="padding:0 40px;"><div class="rule" style="border-top:1px solid #EADFCF;height:0;line-height:0;font-size:0;">&nbsp;</div></td>
                </tr>
                <tr>
                  <td class="pad" style="padding:20px 40px ${second ? '8px' : '30px'};font-family:${FONT};">
                    <p class="muted" style="margin:0;font-size:14px;line-height:21px;color:#62554A;">${e(w.unsubscribeLead)} <a class="link" href="${e(unsubscribe)}" style="color:#984A14;text-decoration:underline;">${e(w.unsubscribe)}</a> · ${e(w.unsubscribeApp)}</p>
                  </td>
                </tr>${second ? `
                <tr>
                  <td class="pad" style="padding:14px 40px 30px;font-family:${FONT};" lang="en">
                    <p class="text" style="margin:0 0 4px;font-size:15px;line-height:22px;font-weight:600;color:#2A231C;">${e(second.heading)}</p>
                    <p class="muted" style="margin:0;font-size:14px;line-height:21px;color:#62554A;">${e(second.body)} ${e(second.unsubscribeLead)} <a class="link" href="${e(unsubscribeUrl(origin, token, 'en'))}" style="color:#984A14;text-decoration:underline;">${e(second.unsubscribe)}</a></p>
                  </td>
                </tr>` : ''}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 24px 0;font-family:${FONT};">
              <p class="muted" style="margin:0 0 8px;font-size:14px;line-height:20px;font-weight:600;color:#62554A;">${e(w.tagline)}</p>
              <p class="muted" style="margin:0;font-size:12px;line-height:18px;color:#85786A;">
                <a class="link" href="${e(origin)}/legal/impressum" style="color:#984A14;text-decoration:underline;">${e(w.imprint)}</a>
                &nbsp;·&nbsp;
                <a class="link" href="${e(origin)}/legal/datenschutz" style="color:#984A14;text-decoration:underline;">${e(w.privacy)}</a>
                &nbsp;·&nbsp;
                <a class="link" href="mailto:hello@bunprise.de" style="color:#984A14;text-decoration:underline;">hello@bunprise.de</a>
              </p>
              <p class="muted" style="margin:8px 0 0;font-size:12px;line-height:18px;color:#85786A;">${e(w.why)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  const text = [
    w.heading,
    '',
    w.body,
    `${w.button}: ${app}`,
    '',
    `${w.unsubscribeLead} ${w.unsubscribe}: ${unsubscribe}`,
    w.unsubscribeApp,
    ...(second ? ['', `${second.heading}: ${second.body}`, `${second.unsubscribe}: ${unsubscribeUrl(origin, token, 'en')}`] : []),
    '',
    w.why,
    `${w.imprint}: ${origin}/legal/impressum · ${w.privacy}: ${origin}/legal/datenschutz · hello@bunprise.de`,
  ].join('\n')
  return { subject: w.subject, html, text, unsubscribeUrl: unsubscribe }
}
