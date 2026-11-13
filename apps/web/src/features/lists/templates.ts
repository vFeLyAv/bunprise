import type { CoverIcon } from '../../lib/api/lists.types'

// List templates (follows-design §2.3, §2.6): one tap fills the title and the symbol — nothing else. They never
// create a list by themselves, never set a visibility and never ask for or set a date (a birthday is no date
// of ours; review #12). The title is the template's text in the app language at the moment of the tap.

export interface ListTemplate {
  id: 'wishes' | 'birthday' | 'christmas' | 'books'
  icon: CoverIcon
  /** i18n key of the title (lists namespace) */
  titleKey: 'lists.templates.wishes' | 'lists.templates.birthday' | 'lists.templates.christmas' | 'lists.templates.books'
}

export const LIST_TEMPLATES: readonly ListTemplate[] = [
  { id: 'wishes', icon: 'star', titleKey: 'lists.templates.wishes' },
  { id: 'birthday', icon: 'cake', titleKey: 'lists.templates.birthday' },
  { id: 'christmas', icon: 'tree', titleKey: 'lists.templates.christmas' },
  { id: 'books', icon: 'book', titleKey: 'lists.templates.books' },
]
