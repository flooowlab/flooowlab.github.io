# Project guidance

- This is an Astro site published at https://flooowlab.github.io.
- Use Node.js 22, install dependencies with `npm install`, and validate changes with `npm run build`.
- `npm run dev` starts local development; `npm run preview` serves a production build locally.
- There are no configured test or lint scripts; the Astro build is the available validation check.
- `.github/workflows/deploy.yml` publishes on pushes to `main` and manual dispatch. GitHub Pages must use **GitHub Actions** as its source.
- Preserve the root-domain `site` setting in `astro.config.mjs`; this user/org site does not need a `base` path.
- See [README.md](README.md) for content locations and deployment setup details.