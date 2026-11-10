import type { MetadataRoute } from "next";
import { ANSWER_PAGES } from "@/lib/answers";
import { FIX_PAGES } from "@/lib/fix-pages";
import { MOVED_FIX_PAGES } from "@/lib/problems/moved-fix";
import { nichePath, problemPath, publishedNiches, publishedProblemPages } from "@/lib/problems";
import { getSiteUrl } from "@/lib/site-url";

type Route = {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
};

const ROUTES: Route[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/learn-more", priority: 0.8, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/download", priority: 0.8, changeFrequency: "monthly" },
  { path: "/ai", priority: 0.7, changeFrequency: "weekly" },
  { path: "/one-chat", priority: 0.7, changeFrequency: "monthly" },
  { path: "/voice", priority: 0.7, changeFrequency: "monthly" },
  { path: "/learn-more/whats-new", priority: 0.6, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const now = new Date();

  const pages: MetadataRoute.Sitemap = ROUTES.map((route) => ({
    url: new URL(route.path, base).href,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const fixEntries: MetadataRoute.Sitemap = [
    {
      url: new URL("/fix", base).href,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...FIX_PAGES.filter((page) => !MOVED_FIX_PAGES[page.slug]).map((page) => ({
      url: new URL(`/fix/${page.slug}`, base).href,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];

  const answerEntries: MetadataRoute.Sitemap = ANSWER_PAGES.map((page) => ({
    url: new URL(`/ai/${page.slug}`, base).href,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const howEntries: MetadataRoute.Sitemap = [
    { url: new URL("/how", base).href, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...publishedNiches().map((niche) => ({
      url: new URL(nichePath(niche), base).href,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...publishedProblemPages().map((page) => ({
      url: new URL(problemPath(page), base).href,
      lastModified: new Date(`${page.lastChecked}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];

  const docsEntries: MetadataRoute.Sitemap = [
    {
      url: new URL("/docs/media", base).href,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];

  return [...pages, ...answerEntries, ...howEntries, ...fixEntries, ...docsEntries];
}
