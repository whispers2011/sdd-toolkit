# Prompt-Contract: Dokument-Verweis im Arbeitsschritt-Auftrag

Der Verweis auf hinterlegte Dokumente ist die Schnittstelle des Toolkits zum Agenten. Er
wird in `packages/shared/src/featureDocuments.ts` als **reine Funktion** gebaut und ist
damit in `packages/shared` isoliert testbar:

```ts
buildDocumentsPreamble(phase: FeaturePhase, docs: FeatureDocument[]): string
```

Injiziert wird das Ergebnis in `Orchestrator.launchPhase()`
(`packages/server/src/services/orchestrator.ts:419`), bei **jedem** Phasenstart (R5).

---

## Format

**Ohne Dokumente** (`docs.length === 0`): leerer String `''`.

Der Prompt ist dann zeichengleich mit dem heutigen — kein leerer Abschnitt, keine
zusätzlichen Tokens (FR-017, SC-006).

**Mit Dokumenten**, Phase `specify`:

```text

[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt (Ablage: specs/kundenimport/docs/):
- `Anforderungen 2026.pdf` → specs/kundenimport/docs/Anforderungen 2026.pdf (1.2 MB)
- `schema.sql` → specs/kundenimport/docs/schema.sql (4.3 KB)
Verwende dieses Material als Ausgangsbasis der Spezifikation.
```

**Mit Dokumenten**, alle übrigen Phasen (`clarify`, `plan`, `checklist`, `analyze`,
`tasks`, `implement`) — identischer Kopf und identische Liste, andere Schlusszeile:

```text
Berücksichtige dieses Material bei diesem Schritt; lies gezielt, was für den Schritt relevant ist.
```

---

## Regeln

| Regel | Quelle |
|---|---|
| Beginnt mit `\n\n`, damit der Block sich vom vorangehenden Prompt-Text absetzt | Konvention `templateHint`/`knowledgePreamble` |
| Nennt Anzeigename (Originalname) **und** Fundort relativ zur Worktree-Wurzel | FR-006, FR-007 |
| Nennt die Größe je Dokument — hilft dem Agenten beim Priorisieren | — |
| Enthält **keinen** Dateiinhalt, auch keine Auszüge oder Zusammenfassungen | FR-009, Edge Case „Sehr großes Dokument" |
| Sagt nicht zu, dass jedes Format lesbar ist — Formatentscheidung liegt beim Agenten | FR-013, Edge Case „Dateiformat, das der Agent nicht lesen kann" |
| Wird bei jedem Phasenstart erneut gesendet, auch nach `/compact` oder `/clear` | FR-007, FR-008, SC-003 |
| Wird frisch aus dem Manifest gelesen, nicht aus dem Prozessspeicher | R5 |

---

## Position im Gesamtprompt

```text
<slash-command> [<extraPrompt>]        ← bisher: phaseSlashCommand + ggf. Beschreibung
+ <Dokument-Verweis>                   ← NEU (leer ohne Dokumente)
+ [<Wissens-Präambel>]                 ← bisher, weiterhin bedingt (Reset/Änderung)
+ <Vorlagen-Hinweis>                   ← bisher: templateHint(phase)
```

Der Dokument-Verweis steht **vor** der Wissens-Präambel, weil er zum Auftrag selbst gehört
(„worauf setzt dieser Schritt auf"), während die Präambel Hintergrundwissen einbringt. Er
unterliegt ausdrücklich **nicht** der Verdichtung durch `compress()`
(`contextOptimizer.ts:70`) — Dateipfade dürfen nicht gekürzt werden.

---

## Beispiel: vollständiger Specify-Prompt

Feature `kundenimport`, Beschreibung „Kundendaten aus der Altanwendung übernehmen",
zwei Dokumente, kein Projektwissen:

```text
/speckit-specify specs/kundenimport Kundendaten aus der Altanwendung übernehmen

[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt (Ablage: specs/kundenimport/docs/):
- `Anforderungen 2026.pdf` → specs/kundenimport/docs/Anforderungen 2026.pdf (1.2 MB)
- `schema.sql` → specs/kundenimport/docs/schema.sql (4.3 KB)
Verwende dieses Material als Ausgangsbasis der Spezifikation.

[Hinweis] `spec.md` liegt im Spec-Ordner bereits als Vorlage vor. Lies sie, bevor du sie schreibst — sonst schlägt der erste Schreibvorgang fehl.
```

Ohne Beschreibung (FR-010) entfällt lediglich der Text hinter dem Slash-Command; der
Dokument-Block bleibt unverändert und trägt den Lauf allein.
