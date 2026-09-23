# MouseWeightLogger

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="MouseWeightLogger icon" />
</p>

Local desktop app for daily mouse weigh-ins, colony metadata, and interactive weight curves. Runs on macOS, Windows, and Linux. The log lives in SQLite on this computer and works offline. Sharing a colony with another computer is optional.

## What it does

- **Today** — weigh active mice for the day. Cards show ♀ / ♂, age, last weight, and % of a configurable baseline.
- **Mice** — roster grouped by experiment / cohort. Add, edit, inactivate, or delete. Each mouse gets a unique plot color; photos and extra fields (strain, genotype, cage, ear mark, notes) are optional. One CSV export includes mice and daily weights.
- **Curves** — interactive Plotly viewer. Pick mice or a whole cohort, drag to pan, scroll to zoom, home / double-click to reset. Save a PNG with the legend.

## Screenshots

**Today**

<img src="docs/screenshots/today.png" alt="Today weigh-in screen" width="960" />

**Mice**

<img src="docs/screenshots/mice.png" alt="Mice roster grouped by cohort" width="960" />

**Curves**

<img src="docs/screenshots/curves.png" alt="Weight curves viewer" width="960" />

## Run

You need [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/).

```bash
npm install
npm run tauri dev
```

## Build a desktop installer

```bash
npm run tauri build
```

## Sharing a colony

Each install can keep several colonies. They do not share mice or weights. The first time you open the app, the log on this computer becomes a colony named **This computer** and stays private until you share it.

Colonies sit in the header as pills.

- Click a pill’s name to show that colony on Today, Mice, and Curves.
- The pencil opens that colony: rename it, invite another computer, or remove it from this computer.
- **+** creates a colony on this computer, or joins one with a code.

An owner invites another computer as an owner (edit, delete, invite) or a watcher (view only, CSV export still works). The other computer types that code and nothing else. Codes expire after 7 days and work once.

Removing a colony drops it from this computer. Other computers that still have it keep their copy. If this is the last computer, the shared colony is deleted too. The app says which of those will happen before you confirm.

While you are offline, owner edits stay on this computer and upload the next time the shared colony can be reached. If two owners change the same mouse or the same weigh-in, the later edit wins.

## Data

The database and imported photos live in the OS app-data directory, not in this repo:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/com.maxchalabi.mouseweightlogger/` |
| Windows | `%APPDATA%\com.maxchalabi.mouseweightlogger\` |
| Linux | `~/.local/share/com.maxchalabi.mouseweightlogger/` |

## Stack

Tauri 2, React, TypeScript, Tailwind, SQLite (`tauri-plugin-sql`), Plotly. Optional colony sync uses Supabase.

## License

[MIT](LICENSE)
