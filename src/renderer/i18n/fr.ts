/** Textes de l'interface en français (langue par défaut). */
export const fr = {
  'app.name': 'Boutique Gestion',
  'app.skipToContent': 'Aller au contenu principal',

  'nav.label': 'Navigation principale',
  'nav.settings': 'Paramètres',
  'nav.settings.appearance': 'Apparence',
  'nav.about': 'À propos',
  'nav.dev.gallery': 'Galerie des composants',
  'nav.back': 'Retour',
  'nav.breadcrumb': 'Fil d’Ariane',

  'search.open': 'Rechercher ou aller à…',
  'search.placeholder': 'Tapez le nom d’un écran…',
  'search.title': 'Recherche rapide',
  'search.description': 'Utilisez les flèches pour choisir, Entrée pour ouvrir, Échap pour fermer.',
  'search.empty': 'Aucun résultat pour « {query} ».',
  'search.results': 'Résultats',

  'settings.title': 'Paramètres',
  'settings.description': 'Réglages de ce poste et de l’application.',
  'settings.appearance.title': 'Apparence',
  'settings.appearance.description': 'Thème, taille du texte et langue de ce poste.',
  'settings.appearance.open': 'Ouvrir',

  'appearance.theme': 'Thème',
  'appearance.theme.light': 'Clair',
  'appearance.theme.dark': 'Sombre',
  'appearance.theme.system': 'Comme Windows',
  'appearance.textScale': 'Taille du texte',
  'appearance.textScale.90': 'Petite (90 %)',
  'appearance.textScale.100': 'Normale (100 %)',
  'appearance.textScale.110': 'Grande (110 %)',
  'appearance.textScale.125': 'Très grande (125 %)',
  'appearance.language': 'Langue de l’interface',
  'appearance.language.fr': 'Français',
  'appearance.language.en': 'English',
  'appearance.saved': 'Préférence enregistrée.',

  'about.title': 'À propos',
  'about.description': 'Version installée et composants techniques.',
  'about.version': 'Version',
  'about.electron': 'Electron',
  'about.chrome': 'Chromium',
  'about.node': 'Node.js',
  'about.mode': 'Mode',
  'about.mode.packaged': 'Application installée',
  'about.mode.development': 'Développement',

  'state.loading': 'Chargement…',
  'state.error.title': 'Une erreur est survenue',
  'state.error.retry': 'Réessayer',
  'state.preferences.error': 'Impossible de lire les préférences de ce poste.',
  'state.preferences.solution': 'Réessayez. Si le problème persiste, redémarrez l’application.',
  'state.about.error': 'Impossible de lire les informations de version.',

  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.notifications': 'Notifications',
} as const;

export type TranslationKey = keyof typeof fr;
