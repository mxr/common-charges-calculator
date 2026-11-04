import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // "$" ends the match, so "/?b=..." budget URLs stay unindexed.
      allow: ["/$", "/_next/static/", "/icon.svg"],
      disallow: "/",
    },
  };
}
