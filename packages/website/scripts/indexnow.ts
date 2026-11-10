// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver…) about changed
// stella.sh pages. The key is public by design: it is served at
// https://stella.sh/<key>.txt from public/. Run after a website deploy:
//   bun scripts/indexnow.ts                 every URL in the live sitemap
//   bun scripts/indexnow.ts /ai /pricing    just these paths
const KEY = "d956595a16cfd56ac830439dbfaac862";
const HOST = "stella.sh";

async function sitemapUrls(): Promise<string[]> {
  const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
}

const args = process.argv.slice(2);
const urlList = args.length ? args.map((p) => new URL(p, `https://${HOST}`).href) : await sitemapUrls();

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow ${res.status} ${res.statusText} for ${urlList.length} URLs`);
if (res.status >= 400) {
  console.log(await res.text());
  process.exit(1);
}

export {};
