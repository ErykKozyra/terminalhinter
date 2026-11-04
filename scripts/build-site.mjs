// Builds the website for GitHub Pages into site/dist: site/page.html wrapped into a full document with the search
// and sharing tags of site/head.html, the files of site/public next to it, and a sitemap.
import fs from "node:fs";
import path from "node:path";

const site = "https://erykkozyra.github.io/terminalhinter/";
const out = "site/dist";
const page = fs.readFileSync("site/page.html", "utf8");
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const date = new Date().toISOString().slice(0, 10);

const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// the questions on the page, so the structured data always says the same as the visible text
const faq = [...page.matchAll(/<div class="qa">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)].map(([, q, a]) => ({
  "@type": "Question",
  name: plain(q),
  acceptedAnswer: { "@type": "Answer", text: plain(a) },
}));
if (faq.length === 0) throw new Error("no questions found in site/page.html");

const head = fs
  .readFileSync("site/head.html", "utf8")
  .replace("{{version}}", version)
  .replace("{{date}}", date)
  .replace("{{faq}}", JSON.stringify(faq, null, 2).replace(/\n/g, "\n      "));

// the page's own short title and description are for the preview; the head file has the full ones
const top = page
  .slice(0, page.indexOf("<style>"))
  .replace(/<title>[\s\S]*?<\/title>\n?/, "")
  .replace(/<meta name="description"[^>]*>\n?/, "")
  .replace(/<meta name="claude:[^>]*>\n?/g, "");
const style = page.slice(page.indexOf("<style>"), page.indexOf("</style>") + 8);
const body = page.slice(page.indexOf("</style>") + 8);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}${top}${style}
</head>
<body>
${body}
</body>
</html>
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
for (const file of fs.readdirSync("site/public")) fs.copyFileSync(path.join("site/public", file), path.join(out, file));
fs.writeFileSync(
  path.join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}</loc><lastmod>${date}</lastmod></url>
</urlset>
`,
);
console.log(`${out}/index.html`, html.length, "bytes,", faq.length, "questions");
