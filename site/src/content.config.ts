import { glob } from 'astro/loaders';
import {
  defineCollection,
  z,
} from 'astro:content';

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    section: z.enum(["core", "dreamer"]).default("core"),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    author: z.string().default("Ross Douglas"),
  }),
});

export const collections = { docs, blog };
