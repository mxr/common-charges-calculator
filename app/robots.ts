import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // "$" ends the match, so "/?b=..." budget URLs stay unindexed.
        allow: ["/$", "/_next/static/", "/icon.svg"],
        disallow: "/",
      },
      {
        // AI-training opt-out tokens; they have no user agent, so the vercel.json firewall rule can't block them.
        userAgent: ["Google-Extended", "Applebot-Extended"],
        disallow: "/",
      },
    ],
  };
}
