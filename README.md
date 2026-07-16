# Dashboard

Lokales Admin-Bookmark-Dashboard ohne Frontend-Frameworks.

## Start mit Dateipersistenz

Die Oberfläche lädt und speichert Kategorien und Lesezeichen über die lokale API in `data/bookmarks.json`.

```bash
node server.js
```

Danach im Browser öffnen:

```text
http://localhost:8000
```

## API

- `GET /api/bookmarks` liest `data/bookmarks.json`.
- `POST /api/bookmarks` schreibt die übermittelte JSON-Konfiguration nach `data/bookmarks.json`.

Wenn die API nicht erreichbar ist, zeigt die UI eine klare Fehlermeldung an und speichert keine Daten im Browser.
