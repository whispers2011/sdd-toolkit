# Phase 1 Data Model: Icon-Katalog & Emoji→Icon-Mapping

Dieses Feature hat kein persistentes Datenmodell. Die „Entitäten" aus der Spec sind Design-Artefakte: das **Icon**, der **Icon-Katalog** und die **Emoji→Icon-Zuordnung**. Diese Tabelle ist die verbindliche Referenz für die Umsetzung (jede Zeile = eine zu ersetzende Stelle) und für den Nachweis der Vollständigkeit (SC-001/SC-003).

## Entität: Icon (Komponenten-„Schema")

Jedes Icon ist eine React-Komponente mit einheitlicher Signatur (Details im UI-Contract):

| Feld | Typ | Regel |
|------|-----|-------|
| `className` | `string?` | optional; überschreibt/ergänzt Größe & Farbe (Default `1em`, `currentColor`) |
| `title` | `string?` | optional; nur wenn das Icon selbst die einzige Bedeutungsquelle ist → setzt `aria-label` + entfernt `aria-hidden` |
| (intern) `stroke` | fix | `currentColor` |
| (intern) `fill` | fix | `none` (Outline-Stil) |
| (intern) `viewBox` | fix | `0 0 24 24`, `stroke-width=2`, `round` caps/joins |
| (intern) `aria-hidden` | Default `true` | entfällt, wenn `title` gesetzt |

## Icon-Katalog (semantische Namen → Bedeutung)

Ein Icon je Bedeutung; gleiche Bedeutung an mehreren Stellen nutzt dasselbe Icon (FR-005, SC-003).

| Semantischer Name | Bedeutung | Angelehnt an (Lucide) | Ersetzt Glyph |
|-------------------|-----------|-----------------------|---------------|
| `KnowledgeIcon` | Wissensdatenbank öffnen | `library` / `book-open` | 📚 |
| `BundleIcon` | Bundle (Gruppe) | `package` | 📦 |
| `EntryIcon` | Eintrag / Dokument | `file-text` | 📄 |
| `BundlePlusIcon` | Unter-Bundle hinzufügen | `package-plus` | +📦 |
| `EntryPlusIcon` | Eintrag hinzufügen | `file-plus` | +📄 |
| `EditIcon` | Bearbeiten | `pencil` | ✎ |
| `DeleteIcon` | Löschen | `trash-2` | 🗑 |
| `RefreshIcon` | Aus Datei neu laden | `refresh-cw` / `rotate-cw` | ⟳ |
| `CloseIcon` | Schließen / Verwerfen | `x` | ✕ |
| `ChatIcon` | Projekt-/Wissens-Chat öffnen | `message-circle` | 💬 |
| `IdeaIcon` | Feature-Vorschlag | `lightbulb` | 💡 |
| `CheckIcon` | Angenommen / Erfolg | `check` | ✓ |
| `WarningIcon` | Fehler / Warnung | `alert-triangle` | ⚠ |
| `RestartIcon` | Neue Unterhaltung | `rotate-ccw` | ↺ |
| `PauseIcon` | Antwort unterbrochen | `pause` | ⏸ |

**Nicht im Katalog (out of scope, typografisch)**: `▍` (streamender Cursor), `→` (Text-Pfeil im Button-Label).

## Emoji→Icon-Zuordnung nach Fundstelle (Ersetzungsplan)

Verbindliche Liste aller zu ändernden Stellen. Zeilennummern sind Orientierung (können durch Edits verschieben).

### Wissensdatenbank

| Datei | ~Zeile | Glyph | Icon | Kontext / Farbe | A11y |
|-------|--------|-------|------|-----------------|------|
| `Sidebar.tsx` | 79 | 📚 | `KnowledgeIcon` | Button, `title="Projektspezifisches Wissen"` | dekorativ, Button hat `title` |
| `FeatureConsole.tsx` | 41 | 📚 | `KnowledgeIcon` | `HeaderIcon`, `title` gesetzt | dekorativ |
| `KnowledgePanel.tsx` | 118 | 📦 | `BundleIcon` | `<span text-zinc-500>` Marker | dekorativ (`aria-hidden`) |
| `KnowledgePanel.tsx` | 122 | +📦 | `BundlePlusIcon` | `IconBtn title="Unter-Bundle"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 123 | +📄 | `EntryPlusIcon` | `IconBtn title="Eintrag"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 124 | ✎ | `EditIcon` | `IconBtn title="Bearbeiten"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 135 | 🗑 | `DeleteIcon` | `IconBtn title="Löschen"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 162 | 📄 | `EntryIcon` | `<span text-zinc-600>` Marker | dekorativ |
| `KnowledgePanel.tsx` | 172 | ⟳ | `RefreshIcon` | `IconBtn title="Aus Datei neu laden"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 174 | ✎ | `EditIcon` | `IconBtn title="Bearbeiten"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 185 | 🗑 | `DeleteIcon` | `IconBtn title="Löschen"` | dekorativ, Button `title` |
| `KnowledgePanel.tsx` | 198 | 📦/📄 | `BundleIcon`/`EntryIcon` | IndexView-Marker (bedingt) | dekorativ |
| `KnowledgePanel.tsx` | 305 | ⟳ (Prosa) | Inline-`RefreshIcon` **oder** Umformulierung | Editor-Label-Text | siehe research.md Entsch. 5 |
| `FeatureKnowledgeSelect.tsx` | 56 | 📦/📄 | `BundleIcon`/`EntryIcon` | Listen-Marker (bedingt) | dekorativ |

### Wissens-Chat

| Datei | ~Zeile | Glyph | Icon | Kontext / Farbe | A11y |
|-------|--------|-------|------|-----------------|------|
| `ChatBubble.tsx` | 26 | 💬 / ✕ | `ChatIcon` / `CloseIcon` | Toggle-Button (`text-xl`), `title` je Zustand | dekorativ, Button `title` |
| `ChatPanel.tsx` | 109 | ↺ | `RestartIcon` | Button „Neu", `title="Neue Unterhaltung beginnen"` | Button `title`; Text „Neu" bleibt |
| `ChatPanel.tsx` | 117 | ✕ | `CloseIcon` | Schließen-Button, `title="Schließen"` | dekorativ, Button `title` |
| `ChatPanel.tsx` | 148 | ✕ | `CloseIcon` | Fehler-Dismiss-Button | dekorativ |
| `ChatPanel.tsx` | 217 | 💡 | `IdeaIcon` | `text-sky-300` Vorschlags-Marker | dekorativ |
| `ChatPanel.tsx` | 225 | ✓ | `CheckIcon` | `text-emerald-400` Status „angenommen" | dekorativ (Text folgt) |
| `ChatPanel.tsx` | 274 | ⚠ | `WarningIcon` | `text-red-400` Fehlerhinweis | dekorativ (Text folgt) |
| `ChatPanel.tsx` | 277 | ⏸ | `PauseIcon` | `text-amber-400` Unterbrechungshinweis | dekorativ (Text folgt) |

**Nicht ändern** (`ChatPanel.tsx`): `▍` (~Z. 272, streamender Cursor) und `→` (~Z. 251, „Zur Feature-Konsole →").

## Validierungsregeln (aus Requirements abgeleitet)

- **VR-1 (FR-010/SC-001)**: Nach der Umstellung enthält keine der 6 Dateien mehr ein Katalog-Glyph zu Icon-Zwecken (Grep-Check). Ausnahmen: `▍`, `→`.
- **VR-2 (FR-005/SC-003)**: Jede Bedeutung wird durch genau ein Icon abgebildet; `CloseIcon`, `BundleIcon`, `EntryIcon` treten mehrfach, aber identisch auf.
- **VR-3 (FR-003)**: Kein Icon setzt eine feste Farbe; alle erben `currentColor`. Die farbgebenden Tailwind-Klassen der bestehenden Wrapper bleiben unverändert (Status-/Akzentfarben erhalten).
- **VR-4 (FR-004)**: Alle bisherigen `onClick`-Handler, `title`-Attribute und umgebenden Texte („Neu", „angenommen", Fehlermeldung) bleiben funktional/inhaltlich unverändert.
- **VR-5 (FR-008/SC-006)**: Icon-Größe folgt der Textgröße des Kontexts (`1em`), keine sichtbaren Ausrichtungs-/Größensprünge gegenüber vorher.
