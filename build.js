// Builds the public site into dist/ from index.html.
// index.html is written as page content (it doubles as the preview artifact),
// so this adds the full document head, share-preview tags and hosting files.
//   SITE_URL=https://ishirvasavada.com node build.js
const fs = require('fs');
const path = require('path');

const SITE = (process.env.SITE_URL || 'https://ishirvasavada.com').replace(/\/$/, '');
const root = __dirname;
const out = path.join(root, 'dist');
const hasResume = fs.existsSync(path.join(root, 'resume.pdf'));

let body = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const title = (body.match(/<title>(.*?)<\/title>/) || [, 'Ishir Vasavada'])[1];
const desc = (body.match(/<meta name="description" content="(.*?)">/) || [, ''])[1];
body = body
  .replace(/<title>.*?<\/title>\n?/, '')
  .replace(/<meta name="description"[^>]*>\n?/, '')
  .replace(/<meta name="claude:[^>]*>\n?/, '')
  .replace(/<!--resume-link-->/g, hasResume ? '<a class="btn" href="resume.pdf" target="_blank" rel="noopener">Resume (PDF)</a>' : '');

const shareTitle = 'Ishir Vasavada · AI product leader';
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${SITE}/">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#F1F3EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1019" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/">
<meta property="og:title" content="${shareTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${SITE}/media/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${shareTitle}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${SITE}/media/og.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), head + body + '\n</body>\n</html>\n');
fs.cpSync(path.join(root, 'media'), path.join(out, 'media'), { recursive: true });
fs.copyFileSync(path.join(root, 'favicon.svg'), path.join(out, 'favicon.svg'));
if (hasResume) fs.copyFileSync(path.join(root, 'resume.pdf'), path.join(out, 'resume.pdf'));
fs.writeFileSync(path.join(out, 'CNAME'), new URL(SITE).host + '\n');
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url></urlset>\n`);
fs.writeFileSync(path.join(out, '404.html'), `<!doctype html><meta charset="utf-8"><title>Not found</title><meta http-equiv="refresh" content="0; url=/"><a href="/">Go to the home page</a>\n`);
console.log(`Built ${out} for ${SITE}${hasResume ? ' with resume.pdf' : ' (no resume.pdf yet)'}`);
