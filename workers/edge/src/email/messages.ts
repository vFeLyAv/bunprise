// What the invitation e-mail and its unsubscribe page SAY (docs/spec/invite-email-design.md §0, §7, §8). Neutral by
// design (docs/spec/in-app-invites-design.md §3.2): no names, no occasion titles, no dates — Brevo keeps a log for a
// month — and never anything about reservations, wishes or lists. Two languages on the server: German and English;
// the database stores 'en' for an English app and 'de' for everything else (ru / uk read German here, with a short
// English paragraph at the end of the German mail, like the sign-in code mail supabase/templates/otp.html).

export const MAIL_LANGS = ['de', 'en'] as const
export type MailLang = (typeof MAIL_LANGS)[number]

export const mailLang = (value: unknown): MailLang => (value === 'en' ? 'en' : 'de')

export interface MailWords {
  subject: string
  /** the hidden preview line in the inbox */
  preview: string
  heading: string
  body: string
  button: string
  /** why you get this mail */
  why: string
  unsubscribeLead: string
  unsubscribe: string
  /** how else to switch it off */
  unsubscribeApp: string
  tagline: string
  imprint: string
  privacy: string
  /** alt text of the bunny picture */
  pictureAlt: string
}

export const MAIL: Record<MailLang, MailWords> = {
  de: {
    subject: 'Neue Einladung in Bunprise',
    preview: 'Jemand hat dich in Bunprise eingeladen. Öffne die App, um sie zu sehen.',
    heading: 'Neue Einladung',
    body: 'Jemand hat dich in Bunprise eingeladen. Öffne die App, um sie zu sehen.',
    button: 'Bunprise öffnen',
    why: 'Du bekommst diese E-Mail, weil du in Bunprise „Bei neuen Einladungen eine E-Mail schicken“ eingeschaltet hast.',
    unsubscribeLead: 'Keine E-Mails mehr zu Einladungen?',
    unsubscribe: 'Abbestellen',
    unsubscribeApp: 'Oder in der App: Profil › Privatsphäre.',
    tagline: 'Träumen. Wünschen. Freude schenken.',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    pictureAlt: 'Pompon, der Bunprise-Hase',
  },
  en: {
    subject: 'New invitation in Bunprise',
    preview: 'Someone invited you on Bunprise. Open the app to see it.',
    heading: 'New invitation',
    body: 'Someone invited you on Bunprise. Open the app to see it.',
    button: 'Open Bunprise',
    why: 'You get this email because you switched on “Send me an email about new invitations” in Bunprise.',
    unsubscribeLead: 'No more emails about invitations?',
    unsubscribe: 'Unsubscribe',
    unsubscribeApp: 'Or in the app: Profile › Privacy.',
    tagline: 'Dream. Wish. Give joy.',
    imprint: 'Imprint',
    privacy: 'Privacy',
    pictureAlt: 'Pompon, the Bunprise bunny',
  },
}

export interface PageWords {
  title: string
  confirmHeading: string
  confirmBody: string
  confirmButton: string
  doneHeading: string
  doneBody: string
  expiredHeading: string
  expiredBody: string
  unavailableHeading: string
  unavailableBody: string
  openApp: string
}

/** The unsubscribe page of the Worker (GET = confirm with one button, POST = done / expired). */
export const PAGE: Record<MailLang, PageWords> = {
  de: {
    title: 'E-Mails zu Einladungen abbestellen – Bunprise',
    confirmHeading: 'E-Mails zu Einladungen abbestellen?',
    confirmBody: 'Du bekommst dann keine E-Mail mehr, wenn dich jemand in Bunprise einlädt. In der App siehst du Einladungen weiterhin.',
    confirmButton: 'Abbestellen',
    doneHeading: 'Erledigt',
    doneBody: 'Du bekommst keine E-Mails mehr zu Einladungen. In der App siehst du Einladungen weiterhin. Wieder einschalten kannst du es in der App unter Profil › Privatsphäre.',
    expiredHeading: 'Dieser Link ist abgelaufen',
    expiredBody: 'Du kannst E-Mails zu Einladungen in der App unter Profil › Privatsphäre ausschalten.',
    unavailableHeading: 'Gerade nicht möglich',
    unavailableBody: 'Bitte versuche es später noch einmal, oder schalte die E-Mails in der App unter Profil › Privatsphäre aus.',
    openApp: 'Bunprise öffnen',
  },
  en: {
    title: 'Unsubscribe from invitation emails – Bunprise',
    confirmHeading: 'Unsubscribe from invitation emails?',
    confirmBody: 'You will no longer get an email when someone invites you on Bunprise. You will still see invitations in the app.',
    confirmButton: 'Unsubscribe',
    doneHeading: 'Done',
    doneBody: 'You will no longer get emails about invitations. You will still see invitations in the app. You can switch it on again in the app under Profile › Privacy.',
    expiredHeading: 'This link has expired',
    expiredBody: 'You can switch off invitation emails in the app under Profile › Privacy.',
    unavailableHeading: 'Not possible right now',
    unavailableBody: 'Please try again later, or switch off the emails in the app under Profile › Privacy.',
    openApp: 'Open Bunprise',
  },
}
