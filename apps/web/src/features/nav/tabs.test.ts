import { describe, expect, it } from 'vitest'
import { TABS, TAB_GROUPS, tabForPath, tabForRouteId, tabIndex, tabPlace } from './tabs'

describe('tab bar destinations (wave 2)', () => {
  it('has Start · Listen · Ideen · Profil in this order, pointing at the four top-level screens', () => {
    expect(TABS.map((tab) => [tab.id, tab.to, tab.label])).toEqual([
      ['start', '/soon', 'nav.start'],
      ['lists', '/lists', 'nav.lists'],
      ['gifts', '/gifts', 'nav.gifts'],
      ['profile', '/settings', 'nav.profile'],
    ])
    expect(tabIndex('start')).toBe(0)
    expect(tabIndex('gifts')).toBe(2)
    expect(tabIndex('profile')).toBe(3)
    expect(tabIndex(null)).toBe(-1)
  })

  it('puts two tabs in each glass capsule, so the "+" is the exact centre', () => {
    expect(TAB_GROUPS).toEqual({ left: ['start', 'lists'], right: ['gifts', 'profile'] })
    expect(TABS.map((tab) => tabPlace(tab.id))).toEqual([
      { group: 'left', slot: 0 },
      { group: 'left', slot: 1 },
      { group: 'right', slot: 0 },
      { group: 'right', slot: 1 },
    ])
  })

  it('shows the bar on the top-level routes only (iOS: pushed screens hide it)', () => {
    expect(tabForRouteId('/_authed/soon')).toBe('start')
    expect(tabForRouteId('/_authed/lists')).toBe('lists')
    expect(tabForRouteId('/_authed/lists/')).toBe('lists')
    expect(tabForRouteId('/_authed/gifts')).toBe('gifts')
    expect(tabForRouteId('/_authed/gifts/')).toBe('gifts')
    expect(tabForRouteId('/_authed/settings')).toBe('profile')
    for (const pushed of [
      // the calendar is Start's month view now: /calendar only redirects
      '/_authed/calendar',
      '/_authed/lists/$listId',
      '/_authed/lists_/$listId',
      '/_authed/gifts/$profileId',
      '/_authed/occasions/$occasionId',
      '/_authed/occasions/new',
      '/_authed/occasions/$occasionId_/edit',
      '/_authed/occasions/$occasionId_/wishes/new',
      '/_authed/wishes/$wishId/edit',
      '/_authed/settings_/export',
      '/_authed/settings_/delete',
      '/_authed/welcome',
      '/_authed/welcome_/profile',
      '/legal/impressum',
      '/i',
      '/',
      '',
      undefined,
      null,
    ]) {
      expect(tabForRouteId(pushed)).toBeNull()
    }
  })

  it('maps pathnames exactly (a sub-page of a tab is a pushed screen)', () => {
    expect(tabForPath('/soon')).toBe('start')
    expect(tabForPath('/lists/')).toBe('lists')
    expect(tabForPath('/gifts')).toBe('gifts')
    expect(tabForPath('/settings')).toBe('profile')
    expect(tabForPath('/calendar')).toBeNull()
    expect(tabForPath('/settings/export')).toBeNull()
    expect(tabForPath('/occasions/new')).toBeNull()
    expect(tabForPath('/')).toBeNull()
    expect(tabForPath(undefined)).toBeNull()
  })
})
