import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// French versions live in an fr/ folder beside the English files, so the English
// collections only look at the top level. A French file has the same name as the English one.
const blog = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const books = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/books' }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    status: z.enum(['reading', 'finished', 'to-read']).default('to-read'),
    // whole or half stars, e.g. 4 or 4.5
    rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
    finished: z.coerce.date().optional(),
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

const music = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/music' }),
  schema: z.object({
    title: z.string(),
    artist: z.string().optional(),
    kind: z.enum(['album', 'artist', 'playlist']).default('album'),
    // Albums are either on repeat right now or part of the favorites shelf.
    status: z.enum(['on-repeat', 'favorite']).default('favorite'),
    cover: z.string().optional(),
    description: z.string().optional(),
    order: z.number().optional(),
    year: z.number().optional(),
    rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
    link: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

// Every French version, e.g. blog/fr/my-post.md or books/fr/deep-work.md. Only the words change:
// a post gives its French title and description, a book just your thoughts. Dates, ratings,
// covers and the rest always come from the English file.
const fr = defineCollection({
  loader: glob({ pattern: '*/fr/*.{md,mdx}', base: './src/content' }),
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
  }),
});

export const collections = { blog, books, music, fr };
