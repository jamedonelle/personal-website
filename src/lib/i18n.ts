// English is the default and lives at the site root; French mirrors every page under /fr/.
import { getCollection } from 'astro:content';

export type Lang = 'en' | 'fr';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** For a page's getStaticPaths: one copy per language (`lang` is left out for English). */
export const langParams = [{ lang: undefined }, { lang: 'fr' }] as const;

export function getLang(url: URL): Lang {
  const path = url.pathname.slice(base.length);
  return path === '/fr' || path.startsWith('/fr/') ? 'fr' : 'en';
}

/** A site path such as '/books/' in the given language. */
export const href = (lang: Lang, path: string) => `${base}${lang === 'fr' ? '/fr' : ''}${path}`;

/** The current page in the other language. */
export function switchHref(url: URL, to: Lang) {
  let path = url.pathname.slice(base.length) || '/';
  if (path === '/fr' || path.startsWith('/fr/')) path = path.slice(3) || '/';
  return href(to, path);
}

const en = {
  locale: 'en-US',
  siteDescription: 'My personal site: writing, books, and music.',
  language: 'Language',
  blog: 'Blog',
  books: 'Books',
  music: 'Music',
  // home
  lede: 'Software developer based in the Greater Moncton area.',
  spotlight: 'Spotlight',
  spotlightText: 'An online multiplayer version of the card game 200.',
  play: (name: string) => `Play ${name} →`,
  friends: 'Friends',
  friendSite: (name: string) => `${name}'s site →`,
  // empty states
  nothingHere: 'Nothing to see here.',
  noneYet: { blog: 'No posts yet. Check back soon.', books: 'No books yet. Check back soon.', music: 'No music yet. Check back soon.' },
  backHome: 'Back home',
  // books
  currentlyReading: 'Currently reading',
  previouslyRead: 'Previously read',
  finished: (date: string) => `finished ${date}`,
  bookCover: (title: string) => `Cover of ${title}`,
  stars: (n: string) => `${n} out of 5 stars`,
  // music
  onRepeat: 'On repeat',
  favoriteAlbums: 'Favorite albums',
  playlists: 'Playlists',
  albumCover: (title: string) => `Cover of ${title}`,
  listen: 'Listen',
  linkSoon: 'Link coming soon',
  // blog
  minRead: (n: number) => `${n} min read`,
  morePosts: 'More posts',
  older: '← Older',
  newer: 'Newer →',
  allPosts: '← All posts',
  notTranslated: '',
};

const fr: typeof en = {
  locale: 'fr-CA',
  siteDescription: 'Mon site personnel : écrits, livres et musique.',
  language: 'Langue',
  blog: 'Blogue',
  books: 'Livres',
  music: 'Musique',
  lede: 'Développeur de logiciels établi dans le Grand Moncton.',
  spotlight: 'En vedette',
  spotlightText: 'Une version multijoueur en ligne du jeu de cartes 200.',
  play: (name) => `Jouer à ${name} →`,
  friends: 'Amis',
  friendSite: (name) => `Le site de ${name} →`,
  nothingHere: 'Rien à voir ici.',
  noneYet: {
    blog: 'Aucun article pour l’instant. Revenez bientôt.',
    books: 'Aucun livre pour l’instant. Revenez bientôt.',
    music: 'Aucune musique pour l’instant. Revenez bientôt.',
  },
  backHome: 'Retour à l’accueil',
  currentlyReading: 'Lecture en cours',
  previouslyRead: 'Déjà lus',
  finished: (date) => `terminé le ${date}`,
  bookCover: (title) => `Couverture de ${title}`,
  stars: (n) => `${n} sur 5 étoiles`,
  onRepeat: 'En boucle',
  favoriteAlbums: 'Albums préférés',
  playlists: 'Listes de lecture',
  albumCover: (title) => `Pochette de ${title}`,
  listen: 'Écouter',
  linkSoon: 'Lien à venir',
  minRead: (n) => `${n} min de lecture`,
  morePosts: 'Autres articles',
  older: '← Plus ancien',
  newer: 'Plus récent →',
  allPosts: '← Tous les articles',
  notTranslated: 'Ce texte n’est pas encore traduit en français.',
};

export const ui = { en, fr };

/** Dates in the content are calendar days, so they're shown in UTC to keep the day from shifting. */
export const formatDate = (lang: Lang, date: Date) =>
  date.toLocaleDateString(ui[lang].locale, { dateStyle: 'long', timeZone: 'UTC' });

/** The French version of a post or book (blog/fr/<id>.md, books/fr/<id>.md), if one has been written. */
export async function frenchOf(collection: 'blog' | 'books', id: string) {
  const all = await getCollection('fr');
  return all.find((e) => e.id === `${collection}/fr/${id}`);
}
