# Flooowlab website

Astro site for Flowlab, served at https://flooowlab.github.io.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
```

## Edit content

- `src/data/site.ts`: name, tagline, contact email, navigation
- `src/data/projects.ts`: project list (home and Projects pages)
- `src/data/tools.ts`: management tools (Tools page). Append an object to add one
- `src/pages/2co.astro`: conference page
- `src/styles/global.css`: all styling (one small file)

## Deploy

The repository must be named `flooowlab.github.io` under the `flooowlab` GitHub account or organization.

1. Push to `main`.
2. In the repository, open Settings, then Pages, and set Source to **GitHub Actions**.
3. `.github/workflows/deploy.yml` builds and publishes on every push to `main`.


# flooowlab.github.io
Flooowlab is a practice-based lab within the Visual Communication Design Department of Izmir Uinversity of Economics. It promotes computational media and physical computing through projects on interactive heritage exhibitions and interaction ecologies, while providing tools, devices, and microcontrollers for prototyping.
