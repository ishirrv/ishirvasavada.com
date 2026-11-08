# ishirvasavada.com

Personal site for Ishir Vasavada. One page, no framework, no dependencies.

- `index.html` is the page content. It also works as the claude.ai preview artifact.
- `build.js` wraps it into a complete public site in `dist/`: document head, share-preview tags, favicon, CNAME, robots.txt, sitemap and 404.
- `media/` holds the video, photos and share image.

```bash
SITE_URL=https://ishirvasavada.com node build.js
```

Drop a `resume.pdf` next to `index.html` and the build adds a "Resume (PDF)" button to the hero and contact sections.

## Going live on GitHub Pages

1. Buy the domain.
2. Push to `main1`. The workflow in `.github/workflows/pages.yml` runs `node build.js` and publishes `dist/`.
3. In the repo: Settings → Pages → Source: GitHub Actions. Custom domain: `ishirvasavada.com`. Tick "Enforce HTTPS" once it's offered.
4. At the registrar, add these DNS records:

| Type  | Name | Value |
|-------|------|-------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| CNAME | www  | ishirrv.github.io |

DNS usually takes minutes, sometimes a few hours.
