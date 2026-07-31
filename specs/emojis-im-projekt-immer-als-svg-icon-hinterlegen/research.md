# Phase 0 Research: Emojis als SVG-Icons

Alle offenen Punkte aus der Technical Context sind aufgelöst. Das Feature ist rein visuell; die Recherche konzentriert sich auf die Icon-Bereitstellung und die Wahrung von Design, Zugänglichkeit und Layout.

## Entscheidung 1 — Icon-Quelle: hausinternes Inline-SVG-Set statt Icon-Bibliothek

- **Decision**: Ein eigenes Modul `packages/web/src/components/icons.tsx` mit ~13–15 winzigen React-Komponenten, jede rendert ein Inline-`<svg>`. Keine neue npm-Abhängigkeit.
- **Rationale**:
  - Nur ~13–15 Icons nötig — eine ganze Bibliothek (z. B. `lucide-react`) wäre unverhältnismäßig.
  - Das Projekt ist bewusst schlank (bisher keinerlei Icon-Lib, handgerollte Dialoge, No-op-Web-Tests). Eine Laufzeit-Dependency widerspräche „keine unnötigen Abhängigkeiten".
  - Inline-SVG garantiert vollständige Kontrolle über `currentColor`, `stroke-width` und Größe → erfüllt FR-003/FR-008 direkt.
  - Kein Bundle-/Tree-Shaking-Risiko, kein zusätzlicher Build-Schritt.
- **Alternatives considered**:
  - **`lucide-react`** (MIT): sehr bequem, aber neue Laufzeit-Dependency für eine Handvoll Icons; abgelehnt wegen Dependency-Gewicht und Projekt-Ethos.
  - **Icon-Font**: veraltetes Muster, Zugänglichkeits-/Rendering-Nachteile, farblich unflexibel; abgelehnt.
  - **Externe SVG-Dateien + `<img>`**: kann `currentColor` nicht erben, zusätzliche Requests; abgelehnt.
- **Hinweis zur Geometrie**: Die SVG-Pfade werden am Lucide/Feather-Stil orientiert (24×24 viewBox, `stroke-width` 2, runde Enden). Lucide steht unter ISC/MIT — das Nachbilden/Kopieren einzelner Pfade in ein eigenes Modul ist lizenzkonform; es entsteht dennoch keine Paket-Abhängigkeit.

## Entscheidung 2 — Icon-Stil: monochrome Outline-Icons, `currentColor`

- **Decision**: Outline-Stil (Stroke, nicht Fill), `fill="none"`, `stroke="currentColor"`, `stroke-width={2}`, `viewBox="0 0 24 24"`, `strokeLinecap/Linejoin="round"`.
- **Rationale**: Passt zum reduzierten, dunklen Zinc-Design (dünne Rahmen, gedämpfte Töne). `currentColor` lässt jedes Icon die Textfarbe seines Kontexts übernehmen (z. B. `text-zinc-500`, `text-amber-400`, `text-emerald-400`) → FR-003 und die Statusfarben-Edge-Case ohne Sonderlogik.
- **Alternatives considered**: Gefüllte (solid) Icons — wirken schwerer/prominenter als das aktuelle UI; abgelehnt zugunsten Konsistenz mit dünnen Borders und kleiner Textgrößen. (Dies war die zweite, vom Nutzer nicht beantwortete Clarify-Frage; Outline ist der begründete Default und bleibt bei Bedarf leicht änderbar, da zentral im Modul.)

## Entscheidung 3 — Größe & Ausrichtung: `1em` + `inline-block`, vertikal an Textzeile

- **Decision**: Standardgröße `width/height: 1em` (skaliert mit `text-xs`/`text-sm` des Elternelements), Icon als `inline`/`shrink-0`-Element mit gleicher optischer Ausrichtung wie das ersetzte Glyph. Optionaler `className`-Prop erlaubt Feinjustage (z. B. `h-4 w-4` in Buttons, `text-xl` in der Chat-Bubble).
- **Rationale**: Emoji/Glyphen wurden bisher als Text gerendert und liefen mit der Zeilenhöhe mit. `1em` reproduziert dieses Verhalten → keine Layout-Sprünge (FR-008, SC-006). Die bestehenden Wrapper (`<span className="text-zinc-500">`, `IconBtn`, `HeaderIcon`) liefern Farbe und Größe bereits über Tailwind-Textklassen.
- **Alternatives considered**: Feste px-Größen überall — würde je Kontext manuell abgestimmt werden müssen und die vorhandene Textgrößen-Logik ignorieren; abgelehnt.

## Entscheidung 4 — Zugänglichkeit: dekorativ `aria-hidden`, interaktiv via bestehendes `title`

- **Decision**: Icons rendern per Default `aria-hidden="true"` und `focusable="false"`. Die Bedeutung interaktiver Elemente kommt weiterhin vom `title` des umschließenden `<button>` (bereits vorhanden bei `IconBtn`, `HeaderIcon`, ChatBubble, Reset/Close). Für ein Icon, das ausnahmsweise selbst die einzige Bedeutungsquelle wäre, unterstützt die Komponente einen optionalen `title`/`aria-label`-Prop.
- **Rationale**: Erfüllt FR-006 (interaktive Bedeutung erhalten) und FR-007 (dekorative Marker nicht störend vorgelesen) und behebt zugleich das heutige Problem, dass Emoji als Wort vorgelesen werden. Kein Umbau der bestehenden Button-Struktur nötig.
- **Alternatives considered**: `role="img"` + `aria-label` an jedem Icon — würde dekorative Marker unnötig vorlesbar machen; abgelehnt.

## Entscheidung 5 — Zusammengesetzte Aktionen (`+📦`, `+📄`) und Prosa-Referenzen

- **Decision**: `+📦`/`+📄` (Unter-Bundle/Eintrag hinzufügen) werden zu je **einem** Icon mit „Plus"-Andeutung zusammengeführt (`BundlePlus`/`EntryPlus`, d. h. Bundle-/Dokument-Form mit kleinem Plus). Die Prosa-Referenz „via ⟳ aktualisieren" im Entry-Editor-Label wird entweder durch ein kleines Inline-Icon ersetzt **oder** neutral umformuliert (z. B. „über Aktualisieren neu laden").
- **Rationale**: FR-009 verlangt eine einzige, verständliche Darstellung; ein kombiniertes Icon ist klarer als „+" + separates Icon. Prosa-Glyphen sind kein Button — Umformulierung ist die risikoärmste, barrierefreie Lösung.
- **Alternatives considered**: „+"-Textzeichen vor dem Icon belassen — widerspricht der Vereinheitlichung; abgelehnt.

## Entscheidung 6 — Ausgeschlossene typografische Zeichen

- **Decision**: Der animierte Schreib-Cursor `▍` (streamende Antwort) und der Text-Pfeil `→` im Button-Label „Zur Feature-Konsole →" bleiben unverändert.
- **Rationale**: Beides sind typografische Elemente, keine Icons (siehe Spec-Assumption). Der `▍`-Cursor ist ein bewusst animiertes Text-Element; ein Ersatz brächte keinen Design-Gewinn und Risiko für die Streaming-Animation.
- **Alternatives considered**: Auch diese ersetzen (Clarify-Option C) — vom Nutzer nicht gewählt; bleibt out of scope, zentral leicht nachrüstbar.

## Entscheidung 7 — Verifikation ohne Web-Test-Harness

- **Decision**: Keine Einführung von `@testing-library`/Vitest im Web-Paket. Verifikation = `pnpm --filter @sdd/web typecheck` + `build` (grün) und die manuellen/greifbaren Prüfschritte in `quickstart.md`, inkl. Grep-Check „keine Emoji mehr in den 6 Dateien" (SC-001).
- **Rationale**: Das Web-Paket hat bewusst keine Tests (MVP). Ein Test-Framework nur für dieses visuelle Feature einzuführen wäre Over-Engineering. Der Grep-Check liefert dennoch eine automatisierbare Kontrolle für die vollständige Ersetzung.
- **Alternatives considered**: Snapshot-/RTL-Tests — unverhältnismäßig für ein reines Icon-Swap-Feature; abgelehnt.
