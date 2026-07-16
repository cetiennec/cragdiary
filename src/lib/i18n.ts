import { cookies, headers } from "next/headers";

export type Locale = "en" | "fr";

export const LOCALE_COOKIE = "cragdiary-locale";

const en = {
  nav: {
    climbers: "Climbers",
    newEntry: "New entry",
    myJournal: "My journal",
    logout: "Log out",
    login: "Log in",
    signup: "Sign up",
  },
  footer: "Cragdiary — a shared climbing journal. Free, no tracking, just days on rock.",
  themes: { scrapbook: "Scrapbook", minimal: "Minimal" },
  feed: {
    empty: "No entries yet.",
    logFirst: "Log your first day out",
    createPre: "",
    createLink: "Create an account",
    createPost: " to start your journal.",
  },
  login: {
    title: "Log in",
    username: "Username",
    password: "Password",
    error: "Wrong username or password.",
    submit: "Log in",
    hintPre: "No account yet? ",
    hintLink: "Sign up",
  },
  signup: {
    title: "Start your journal",
    username: "Username",
    usernameHint: "lowercase letters, digits, hyphens",
    displayName: "Display name",
    displayNameHint: "How your name appears",
    password: "Password",
    submit: "Create account",
    hintPre: "Already have one? ",
    hintLink: "Log in",
    errors: {
      username: "Username must be 3–20 characters: lowercase letters, digits, hyphens.",
      name: "Please enter a display name.",
      password: "Password must be at least 8 characters.",
      taken: "That username is already taken.",
      generic: "Something went wrong.",
    },
  },
  editor: {
    titlePlaceholder: "Untitled route or day…",
    titleAria: "Route or day title",
    date: "📅 Date",
    monthOnly: "Month only",
    location: "📍 Location",
    locationPlaceholder: "Verdon, Cap Canaille…",
    style: "🪢 Style",
    stylePlaceholder: "lead, alternating leads, trad…",
    styleOptions: ["lead", "alternating leads", "leading in blocks", "seconding", "toprope", "trad", "aid"],
    grade: "🎯 Max grade",
    gradePlaceholder: "6B, 5C+…",
    rating: "🏔️ Overall difficulty",
    ratingPlaceholder: "AD, D+, TD…",
    pitches: "🪜 Pitches",
    height: "📏 Height (m)",
    partners: "👥 Partners",
    partnersPlaceholder: "Léo, @marine… (@ to tag a climber)",
    routes: "🧭 Routes",
    routesPlaceholder: "For a cragging day: the routes you did",
    visibility: "👁️ Visibility",
    visibilityOptions: {
      public: "🌍 Public — on the main feed",
      unlisted: "🔗 Link only — anyone with the link",
      private: "🔒 Private — just you",
    },
    addPhotos: "🖼️ Add photos",
    c2c: "🔗 Camptocamp",
    c2cPlaceholder: "https://www.camptocamp.org/routes/…",
    notesPlaceholder: "Write about the day — the rock, the light, the people, the vibe…",
    notesAria: "Notes",
    pitchNotesHint: "Pitch by pitch (leave blank to skip):",
    pitchPlaceholder: "6a, nice dihedral, small gear useful…",
    suggestionsAttribution: "data from Camptocamp (CC BY-SA)",
    c2cSummaryTitle: "Camptocamp route summary (CC BY-SA):",
    c2cSummaryInclude: "Show this summary on the entry",
    geoAttribution: "data © OpenStreetMap contributors",
    currentPhotos: "Current photos — reorder with the arrows, tick to remove on save:",
    removePhoto: "Remove",
    movePhotoEarlier: "Move photo earlier",
    movePhotoLater: "Move photo later",
    save: "Save entry",
    saveChanges: "Save changes",
    saving: "Saving…",
  },
  entry: {
    date: "📅 Date",
    monthOnly: "Month only",
    location: "📍 Location",
    style: "🪢 Style",
    grade: "🎯 Max grade",
    rating: "🏔️ Overall difficulty",
    pitches: "🪜 Pitches",
    height: "📏 Height",
    routes: "🧭 Routes",
    partners: "👥 Partners",
    journal: "✍️ Journal",
    topo: "🔗 Topo",
    topoLink: "See on Camptocamp",
    c2cSummarySource: "— Camptocamp (CC BY-SA)",
    pitchNotesTitle: "Pitch by pitch",
    mapTitle: "Map",
    mapOpen: "Open full map",
    edit: "Edit entry",
    delete: "Delete entry",
    deleting: "Deleting…",
    confirmDelete: "Delete this entry? This cannot be undone.",
    badges: { unlisted: "🔗 Link only", private: "🔒 Private" },
  },
  profile: {
    entryCount: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
    emptySelfPre: "Your journal is empty — ",
    emptySelfLink: "log your first day out",
    emptySelfPost: ".",
    emptyOther: "No entries yet.",
    stats: {
      entries: "Entries",
      meters: "Vertical meters",
      thisYear: "This year",
      thisMonth: "This month",
    },
  },
  climbers: { title: "Climbers" },
};

export type Dict = typeof en;

const fr: Dict = {
  nav: {
    climbers: "Grimpeurs",
    newEntry: "Nouvelle entrée",
    myJournal: "Mon carnet",
    logout: "Déconnexion",
    login: "Connexion",
    signup: "Créer un compte",
  },
  footer: "Cragdiary — un carnet de grimpe partagé. Gratuit, sans tracking, juste des journées sur le rocher.",
  themes: { scrapbook: "Carnet", minimal: "Minimal" },
  feed: {
    empty: "Aucune entrée pour l'instant.",
    logFirst: "Racontez votre première sortie",
    createPre: "",
    createLink: "Créez un compte",
    createPost: " pour commencer votre carnet.",
  },
  login: {
    title: "Connexion",
    username: "Nom d'utilisateur",
    password: "Mot de passe",
    error: "Nom d'utilisateur ou mot de passe incorrect.",
    submit: "Se connecter",
    hintPre: "Pas encore de compte ? ",
    hintLink: "Créer un compte",
  },
  signup: {
    title: "Commencez votre carnet",
    username: "Nom d'utilisateur",
    usernameHint: "minuscules, chiffres, tirets",
    displayName: "Nom affiché",
    displayNameHint: "Le nom que les autres verront",
    password: "Mot de passe",
    submit: "Créer le compte",
    hintPre: "Déjà un compte ? ",
    hintLink: "Connexion",
    errors: {
      username: "Le nom d'utilisateur doit faire 3–20 caractères : minuscules, chiffres, tirets.",
      name: "Merci d'indiquer un nom affiché.",
      password: "Le mot de passe doit faire au moins 8 caractères.",
      taken: "Ce nom d'utilisateur est déjà pris.",
      generic: "Une erreur est survenue.",
    },
  },
  editor: {
    titlePlaceholder: "Voie ou journée sans titre…",
    titleAria: "Nom de la voie ou de la journée",
    date: "📅 Date",
    monthOnly: "Mois seulement",
    location: "📍 Lieu",
    locationPlaceholder: "Verdon, Cap Canaille…",
    style: "🪢 Style",
    stylePlaceholder: "en tête, réversible, trad…",
    styleOptions: ["en tête", "réversible", "en flèche", "en second", "moulinette", "trad", "artif"],
    grade: "🎯 Cotation max",
    gradePlaceholder: "6B, 5C+…",
    rating: "🏔️ Difficulté globale",
    ratingPlaceholder: "AD, D+, TD…",
    pitches: "🪜 Longueurs",
    height: "📏 Hauteur (m)",
    partners: "👥 Partenaires",
    partnersPlaceholder: "Léo, @marine… (@ pour taguer un grimpeur)",
    routes: "🧭 Voies",
    routesPlaceholder: "Pour une journée en couenne : les voies faites",
    visibility: "👁️ Visibilité",
    visibilityOptions: {
      public: "🌍 Public — sur le fil principal",
      unlisted: "🔗 Par lien — accessible avec le lien",
      private: "🔒 Privé — vous seul·e",
    },
    addPhotos: "🖼️ Ajouter des photos",
    c2c: "🔗 Camptocamp",
    c2cPlaceholder: "https://www.camptocamp.org/routes/…",
    notesPlaceholder: "Racontez la journée — le rocher, la lumière, les gens, l'ambiance…",
    notesAria: "Notes",
    pitchNotesHint: "Longueur par longueur (laissez vide pour passer) :",
    pitchPlaceholder: "6a, beau dièdre, petits coinceurs utiles…",
    suggestionsAttribution: "données Camptocamp (CC BY-SA)",
    c2cSummaryTitle: "Résumé Camptocamp de la voie (CC BY-SA) :",
    c2cSummaryInclude: "Afficher ce résumé sur l'entrée",
    geoAttribution: "données © contributeurs OpenStreetMap",
    currentPhotos: "Photos actuelles — réordonnez avec les flèches, cochez pour retirer :",
    removePhoto: "Retirer",
    movePhotoEarlier: "Déplacer la photo plus tôt",
    movePhotoLater: "Déplacer la photo plus tard",
    save: "Enregistrer",
    saveChanges: "Enregistrer les modifications",
    saving: "Enregistrement…",
  },
  entry: {
    date: "📅 Date",
    monthOnly: "Mois seulement",
    location: "📍 Lieu",
    style: "🪢 Style",
    grade: "🎯 Cotation max",
    rating: "🏔️ Difficulté globale",
    pitches: "🪜 Longueurs",
    height: "📏 Hauteur",
    routes: "🧭 Voies",
    partners: "👥 Partenaires",
    journal: "✍️ Carnet",
    topo: "🔗 Topo",
    topoLink: "Voir sur Camptocamp",
    c2cSummarySource: "— Camptocamp (CC BY-SA)",
    pitchNotesTitle: "Longueur par longueur",
    mapTitle: "Carte",
    mapOpen: "Ouvrir la carte",
    edit: "Modifier l'entrée",
    delete: "Supprimer l'entrée",
    deleting: "Suppression…",
    confirmDelete: "Supprimer cette entrée ? C'est irréversible.",
    badges: { unlisted: "🔗 Par lien", private: "🔒 Privé" },
  },
  profile: {
    entryCount: (n: number) => (n === 1 ? "1 entrée" : `${n} entrées`),
    emptySelfPre: "Votre carnet est vide — ",
    emptySelfLink: "racontez votre première sortie",
    emptySelfPost: ".",
    emptyOther: "Aucune entrée pour l'instant.",
    stats: {
      entries: "Sorties",
      meters: "Mètres verticaux",
      thisYear: "Cette année",
      thisMonth: "Ce mois-ci",
    },
  },
  climbers: { title: "Grimpeurs" },
};

const dictionaries: Record<Locale, Dict> = { en, fr };

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (fromCookie === "fr" || fromCookie === "en") return fromCookie;

  const headerStore = await headers();
  const acceptLanguage = headerStore.get("accept-language") ?? "";
  return acceptLanguage.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export async function getDict(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}

export function formatDate(dateStr: string, locale: Locale, monthOnly = false): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    ...(monthOnly ? {} : { day: "numeric" as const }),
  });
}

export function formatMeters(meters: number, locale: Locale): string {
  const nf = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
    notation: meters >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  });
  return `${nf.format(meters)} m`;
}
