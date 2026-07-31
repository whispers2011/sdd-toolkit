# UI-Contract: Icon-Modul (`packages/web/src/components/icons.tsx`)

Verbindliche Schnittstelle des hausinternen SVG-Icon-Sets. „Contract" im Sinne einer UI-Applikation: die exportierten Komponenten, ihre Props und ihr garantiertes Verhalten. Konsumenten sind die sechs Zielkomponenten aus `data-model.md`.

## Exportierte Komponenten

Ein benannter Export pro Katalog-Eintrag (siehe `data-model.md`):

```
KnowledgeIcon, BundleIcon, EntryIcon, BundlePlusIcon, EntryPlusIcon,
EditIcon, DeleteIcon, RefreshIcon, CloseIcon, ChatIcon, IdeaIcon,
CheckIcon, WarningIcon, RestartIcon, PauseIcon
```

Jede Komponente ist eine reine Funktionskomponente ohne State/Effekte.

## Props (einheitlich für alle Icons)

```ts
type IconProps = {
  /** Zusätzliche Klassen; überschreibt Default-Größe/-Farbe. */
  className?: string;
  /** Nur setzen, wenn das Icon selbst die einzige Bedeutungsquelle ist.
   *  Gesetzt ⇒ role="img" + aria-label=title, aria-hidden entfällt. */
  title?: string;
};
```

- **Keine** weiteren Pflicht-Props. Kein `color`/`size`-Prop — Farbe/Größe kommen über `currentColor` bzw. `className`/`1em`.

## Verhaltensgarantien (MUST)

1. **Rendering**: genau ein `<svg>` mit `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`.
2. **Größe**: Default `width="1em" height="1em"` — skaliert mit `font-size` des Elternelements. `className` kann dies überschreiben (z. B. `h-4 w-4`).
3. **Farbe**: erbt ausschließlich `currentColor`; **kein** hartkodiertes `stroke`/`fill` mit Farbwert. (VR-3)
4. **Zugänglichkeit**:
   - Ohne `title`: `aria-hidden="true"` und `focusable="false"` (dekorativ). (FR-007)
   - Mit `title`: `role="img"` + `aria-label={title}`, kein `aria-hidden`. (FR-006)
5. **Keine Seiteneffekte / kein globaler Zustand**; mehrfaches Rendern desselben Icons ist erlaubt und identisch.
6. **`className` wird durchgereicht** und mit den Default-Klassen zusammengeführt (überschreibt bei Konflikt).

## Nutzungsmuster (illustrativ, nicht normativ)

- Dekorativer Marker (Farbe/Größe vom Wrapper):
  `<span className="text-zinc-500"><BundleIcon /></span>`
- In bestehendem `IconBtn` (Button trägt bereits `title`):
  `<IconBtn title="Löschen" onClick={…}><DeleteIcon /></IconBtn>`
- Chat-Bubble (größer):
  `open ? <CloseIcon className="h-6 w-6" /> : <ChatIcon className="h-6 w-6" />`

## Nicht-Ziele

- Kein Icon-„Registry"/Lookup per String-Key (YAGNI) — direkte benannte Importe.
- Keine externe Icon-Bibliothek als Abhängigkeit.
- Keine Ersetzung typografischer Zeichen (`▍`, `→`).

## Vertragsverifikation

- **Typecheck**: `pnpm --filter @sdd/web typecheck` grün (Props/Exports korrekt).
- **Statisch**: jedes exportierte Icon nutzt `currentColor` und kein Farbliteral (Review/Grep).
- **A11y-Stichprobe**: dekoratives Icon rendert `aria-hidden`; Icon mit `title` rendert `aria-label`.
