// Wraps site/page.html into a complete document for GitHub Pages: site/dist/index.html
import fs from "node:fs";
const page = fs.readFileSync("site/page.html", "utf8");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.slice(0, page.indexOf("<style>"))}${page.slice(page.indexOf("<style>"), page.indexOf("</style>") + 8)}
</head>
<body>
${page.slice(page.indexOf("</style>") + 8)}
</body>
</html>
`;
fs.mkdirSync("site/dist", { recursive: true });
fs.writeFileSync("site/dist/index.html", html);
console.log("site/dist/index.html", html.length, "bytes");
