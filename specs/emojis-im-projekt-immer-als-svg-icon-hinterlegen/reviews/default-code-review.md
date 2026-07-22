# Code-Review: emojis-im-projekt-immer-als-svg-icon-hinterlegen

**Branch**: `feature/emojis-im-projekt-immer-als-svg-icon-hinterlegen`
**Default-Branch**: `main`
**Merge-Base**: `6c03ec0`
**Review-HEAD**: `3583d63`
**Datum**: 2026-07-22
**Reviewer**: strenger, adversarialer Code-Review

## Zusammenfassung

Der Branch enthält **committete, unaufgelöste Git-Merge-Konflikt-Marker** in zwei
getrackten Quelldateien. Dadurch ist das `@sdd/web`-Paket weder parsebar noch
baubar, und die Konfigurationsdatei `.specify/feature.json` ist kein gültiges
JSON mehr. Das Feature ist in diesem Zustand nicht mergefähig.

Das eigentliche Icon-Modul (`icons.tsx`) und die Umstellung der Wissensdatenbank
(US1) sind für sich genommen sauber. Der Wissens-Chat (US2) ist jedoch defekt:
Der Branch wurde gegen eine **veraltete** `ChatPanel.tsx` (Sprechblasen-Chat)
entwickelt, während `main` diese Komponente inzwischen vollständig durch eine
Terminal-basierte Konsole (`TerminalPane`) ersetzt hat. Der Konflikt wurde nicht
inhaltlich aufgelöst, sondern mit Markern eingecheckt.

---

## Blocker (müssen vor dem Merge behoben werden)

### B1 — Unaufgelöste Konflikt-Marker in `.specify/feature.json` (ungültiges JSON)

`/.specify/feature.json` (Zeilen 2, 4, 6):

```
{
<<<<<<< HEAD
  "feature_directory": "specs/projekt-chat-sollte-eine-claude-code-session-sein"
=======
  "feature_directory": "specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen"
>>>>>>> 41e46a3 (feat(emojis-im-projekt-immer-als-svg-icon-hinterlegen): implementation)
}
```

Die Datei ist **kein gültiges JSON** mehr. Jeder JSON-Parser (und damit die
spec-kit-Tooling-Kette, die `feature_directory` liest) scheitert daran. Der
Konflikt muss auf genau einen `feature_directory`-Wert aufgelöst werden.

### B2 — Unaufgelöste Konflikt-Marker in `packages/web/src/components/ChatPanel.tsx`

`packages/web/src/components/ChatPanel.tsx` enthält drei Konflikt-Blöcke
(Marker in den Zeilen 4/24/28, 156/171/219, 280/281/398). `<<<<<<< HEAD`,
`=======` und `>>>>>>>` sind kein gültiges TypeScript/JSX — der **Typecheck und
Build des gesamten `@sdd/web`-Pakets schlagen fehl** (Datei ist nicht parsebar).
Da `ChatBubble.tsx` `ChatPanel` importiert und rendert, ist der Fehler
transitiv und betrifft die komplette Web-App.

*(Hinweis: `pnpm --filter @sdd/web typecheck` bzw. `tsc` konnten in dieser
nicht-interaktiven Session nicht ausgeführt werden — Berechtigung erforderlich.
Der Fehlschlag ist jedoch rein lexikalisch garantiert: Konflikt-Marker sind kein
gültiger Quelltext.)*

### B3 — `ChatPanel.tsx` ist semantisch inkohärent (falscher Merge-Basiszustand)

Selbst wenn man die Marker mechanisch entfernt, ist die Datei nicht lauffähig.
Die beiden Konfliktseiten sind **zwei sich gegenseitig ausschließende
Implementierungen**:

- **HEAD-Seite (`main`, aktueller Stand)**: `ChatPanel` ist eine echte,
  interaktive Claude-Code-**Konsole** auf Basis von `TerminalPane`
  (Zeilen 5–23, 157–164, 224–237). Kein Nachrichten-State, keine Bubbles.
- **Feature-Seite (`41e46a3`)**: der alte **Sprechblasen-Chat** mit
  `MessageBubble`/`ProposalCard`, `ConfirmDialog`, `NewFeatureDialog` und
  zahlreichen Handlern.

Die Feature-Seite referenziert dutzende Symbole, die im gemergten Component
**gar nicht existieren** (der State der Komponente ist in Zeilen 36–41 auf
`chat`, `error`, `ready`, `size`, `selected` beschränkt):

`messages`, `scrollRef`, `busy`, `liveText`, `declineProposal`, `openFeature`,
`sendError`, `setSendError`, `confirmReset`, `setConfirmReset`, `reset`,
`proposalDialog`, `setProposalDialog`, `proposalCreated` sowie die Typen
`FeatureProposal` und `ChatMessage`.

→ Der Konflikt darf **nicht** durch Übernahme der Feature-Seite gelöst werden —
das würde die neue Terminal-Konsole aus `main` löschen und den alten Chat
wiedereinführen (schwere Regression). Korrekte Auflösung:
**`main`-Version (TerminalPane) behalten** und dort *nur* die verbliebenen
Emoji/Symbole durch Icons ersetzen (siehe B4). Die vom Feature hinzugefügten
Importe `ConfirmDialog`, `NewFeatureDialog` sowie die Icons `RestartIcon`,
`IdeaIcon`, `CheckIcon`, `WarningIcon`, `PauseIcon` sind gegen die
Terminal-Version toter Code und dürften größtenteils entfallen.

### B4 — Wissens-Chat: In-Scope-Emojis bleiben unersetzt (FR-002, FR-010, SC-001 verletzt)

In der überlebenden `main`-Version von `ChatPanel.tsx` sind Icon-Emojis im
Scope **nicht** ersetzt worden, weil das Feature gegen die alte Datei entwickelt
wurde:

- Zeile 243: `💡` im Feature-Vorschlags-Header (US2 Acceptance Scenario 3,
  FR-002).
- Zeilen 162 und 170: `✕` (Schließen im Panel-Kopf sowie Fehler-Ausblenden;
  US2 Acceptance Scenario 1/2, FR-002).

Damit ist **SC-001 („0 Emoji-Zeichen im Wissens-Chat")** und **FR-010
(vollständige Ersetzung im Scope)** verletzt — unabhängig von den Markern.
Die Ersetzungen müssen auf der Terminal-Version nachgezogen werden
(`💡` → `IdeaIcon`, `✕` → `CloseIcon`).

---

## Positiv / korrekt (kein Handlungsbedarf)

- **`icons.tsx`** erfüllt den UI-Contract (`contracts/icon-component.md`)
  sauber: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `strokeWidth={2}`, `width/height="1em"`, keine Farbliterale (VR-3),
  A11y-Logik korrekt (`title` ⇒ `role="img"` + `aria-label`, sonst
  `aria-hidden="true"` + `focusable="false"`). Alle 15 im Contract geforderten
  Exporte sind vorhanden. Reine, seiteneffektfreie Funktionskomponenten.
- **US1 (Wissensdatenbank)** ist vollständig und konsistent umgestellt:
  `Sidebar.tsx` (📚→`KnowledgeIcon`), `FeatureConsole.tsx`
  (📚→`KnowledgeIcon`), `FeatureKnowledgeSelect.tsx` (📦/📄→`BundleIcon`/
  `EntryIcon`), `KnowledgePanel.tsx` (alle Marker + Aktionen inkl. der
  zusammengesetzten `+📦`/`+📄` → `BundlePlusIcon`/`EntryPlusIcon`, FR-009).
  Auch der Text-Hinweis „via ⟳ aktualisieren" wurde zu „über Aktualisieren neu
  laden" bereinigt (KnowledgePanel Zeile 306).
- **Out-of-Scope korrekt belassen**: verbleibende Emojis in `Sidebar.tsx`
  (⚙, 📁, ↑, ●/○) und `FeatureConsole.tsx` (📂, ⌨, 📋, 🎙) betreffen
  Projekt-Einstellungen / Feature-Konsolen-Aktionen und sind laut
  spec-Assumptions nicht Teil des Scopes.
- **`ChatBubble.tsx`** (💬/✕ → `ChatIcon`/`CloseIcon`, `h-6 w-6`) ist korrekt —
  scheitert aber am Build transitiv über B2.

---

## Fazit

Vier Blocker, davon drei um denselben fehlerhaften Merge/Rebase herum:
committete Konflikt-Marker (B1, B2), ein dadurch semantisch zerstörtes
`ChatPanel.tsx` (B3) und die daraus resultierend unvollständige Chat-Umstellung
(B4). Das Paket ist nicht baubar und das Feature-Ziel (0 Emojis im Chat) nicht
erreicht. Die Icon-Grundlage und die Wissensdatenbank-Umstellung sind solide,
aber der Chat-Teil muss gegen den aktuellen `main`-Stand (`TerminalPane`) neu
aufgelöst und die Marker beseitigt werden, bevor gemergt werden kann.

VERDICT: FAIL
