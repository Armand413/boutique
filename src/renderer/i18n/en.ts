import type { TranslationKey } from './fr';

/** English translation: the type forces every French key to exist here. */
export const en: Readonly<Record<TranslationKey, string>> = {
  'app.name': 'Shop Manager',
  'app.skipToContent': 'Skip to main content',

  'nav.label': 'Main navigation',
  'nav.settings': 'Settings',
  'nav.settings.appearance': 'Appearance',
  'nav.about': 'About',
  'nav.dev.gallery': 'Component gallery',
  'nav.back': 'Back',
  'nav.breadcrumb': 'Breadcrumb',

  'search.open': 'Search or go to…',
  'search.placeholder': 'Type a screen name…',
  'search.title': 'Quick search',
  'search.description': 'Use the arrow keys to choose, Enter to open, Escape to close.',
  'search.empty': 'No results for “{query}”.',
  'search.results': 'Results',

  'settings.title': 'Settings',
  'settings.description': 'Settings for this workstation and the application.',
  'settings.appearance.title': 'Appearance',
  'settings.appearance.description': 'Theme, text size and language for this workstation.',
  'settings.appearance.open': 'Open',

  'appearance.theme': 'Theme',
  'appearance.theme.light': 'Light',
  'appearance.theme.dark': 'Dark',
  'appearance.theme.system': 'Same as Windows',
  'appearance.textScale': 'Text size',
  'appearance.textScale.90': 'Small (90%)',
  'appearance.textScale.100': 'Normal (100%)',
  'appearance.textScale.110': 'Large (110%)',
  'appearance.textScale.125': 'Extra large (125%)',
  'appearance.language': 'Interface language',
  'appearance.language.fr': 'Français',
  'appearance.language.en': 'English',
  'appearance.saved': 'Preference saved.',

  'about.title': 'About',
  'about.description': 'Installed version and technical components.',
  'about.version': 'Version',
  'about.electron': 'Electron',
  'about.chrome': 'Chromium',
  'about.node': 'Node.js',
  'about.mode': 'Mode',
  'about.mode.packaged': 'Installed application',
  'about.mode.development': 'Development',

  'state.loading': 'Loading…',
  'state.error.title': 'Something went wrong',
  'state.error.retry': 'Try again',
  'state.preferences.error': 'Unable to read this workstation’s preferences.',
  'state.preferences.solution': 'Try again. If the problem persists, restart the application.',
  'state.about.error': 'Unable to read version information.',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.notifications': 'Notifications',
};
