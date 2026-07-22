# Feature Specification: Token-Verbrauch im SDD-Flow minimieren

**Feature Branch**: `feature/minimize-token-consumption`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Analysiere das zuletzt gebaute feature im SDD flow und wieviele tokens diese verbraucht haben. Implementiere möglichkeiten um den token verbrauch zu verringern, ohne die qualität der lieferartefakte zu mindern. Aktuell verbraucht ein feature im sdd flow eine menge tokens. Ziel ist es den verbrauch zu minimieren indem kontext smart übergeben wird und vielleicht tools eingesetzt werden wie caveman oder ähnliche, welche den tokenverbrauch von unwichtigen Inhalten reduziert"

## Kontext & Ausgangslage *(informativ)*

Ein Feature durchläuft im SDD-Flow mehrere Phasen (specify → clarify → plan → tasks → implement) plus nachgelagerte Läufe (verify, review, ggf. Konfliktauflösung). Jede Phase läuft als Claude-Code-Session im Feature-Worktree. Der bereits vorhandene Kosten-/Token-Zähler erfasst pro Lauf grobe Werte.

Gemessene Ist-Werte (Baseline, Stand 2026-07-22) für kürzlich gebaute Features liegen bei **~40.000–120.000 Tokens** bzw. **~0,45–1,85 USD** pro Feature. Das **zuletzt vollständig gebaute Feature** ("projekt-chat-sollte-eine-claude-code-session-sein") verbrauchte **~97.400 Tokens (~1,46 USD)**, aufgeschlüsselt nach Phase:

| Phase | Tokens | Kosten (USD) |
|-------|--------|--------------|
| implement | ~41.300 | ~0,62 |
| plan | ~32.500 | ~0,49 |
| specify | ~13.400 | ~0,20 |
| tasks | ~6.700 | ~0,10 |
| clarify | ~3.500 | ~0,05 |
| review | (nicht erfasst) | — |

Die größten Treiber sind **implement** und **plan**. Wichtige Einschränkung: Diese Werte sind heute für Phasen-Läufe **nur grob geschätzt bzw. aus Terminal-Ausgabe extrahiert**, nicht autoritativ — eine belastbare Aufschlüsselung ist Voraussetzung, um Optimierungen überhaupt messen zu können.

## Clarifications

### Session 2026-07-22

- Q: Wie soll die ≥30%-Token-Reduktion belastbar nachgewiesen werden (heutige Phasenwerte sind nur geschätzt)? → A: A/B-Vergleich am selben Referenz-Feature — einmal mit, einmal ohne Optimierung, gleiche Messmethode beidseitig; der relative Verbrauchs-Delta gilt als Nachweis.
- Q: Darf die Verdichtung signalarmer Inhalte (P3) selbst Modell-/LLM-Aufrufe nutzen, die Tokens kosten? → A: Beides, konfigurierbar — Standard deterministisch/lokal (ohne Modellkosten); LLM-basierte Verdichtung optional zuschaltbar, aber nur zulässig, wenn der Gesamtverbrauch inkl. dieser Aufrufe messbar unter der Baseline bleibt.
- Q: Für welche Läufe gelten die Reduktionsmaßnahmen (P2/P3)? → A: Nur SDD-Phasen (specify/clarify/plan/tasks/implement). Chat, verify, review und Konfliktauflösung bleiben unverändert; die Messung/Transparenz (P1) erfasst weiterhin alle Lauf-Arten.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Token-Verbrauch pro Feature und Phase sichtbar machen (Priority: P1)

Als Nutzer des SDD-Toolkits will ich für ein Feature sehen, wie viele Tokens und Kosten es verbraucht hat — aufgeschlüsselt nach SDD-Phase — damit ich erkenne, wo die Tokens hingehen, und damit ich eine belastbare Baseline habe, an der sich spätere Optimierungen messen lassen.

**Why this priority**: Dies ist der explizit geforderte erste Schritt ("Analysiere … wieviele Tokens verbraucht") und die Voraussetzung für jede Reduktion — ohne belastbare Messung lässt sich weder ein Problem lokalisieren noch eine Verbesserung nachweisen. Bereits allein liefert die Transparenz Wert (Kostensteuerung, Phasen-Vergleich).

**Independent Test**: Ein abgeschlossenes Feature auswählen und die Verbrauchs-Aufschlüsselung nach Phase (specify/clarify/plan/tasks/implement sowie verify/review/Konfliktauflösung) mit Tokens und Kosten einsehen. Die Summe der Phasenwerte stimmt mit dem ausgewiesenen Feature-Gesamtwert überein.

**Acceptance Scenarios**:

1. **Given** ein Feature mit mehreren abgeschlossenen Phasen-Läufen, **When** der Nutzer den Verbrauch dieses Features aufruft, **Then** wird der Gesamt-Tokenverbrauch und die Gesamtkosten sowie eine Aufschlüsselung je Phase angezeigt.
2. **Given** eine Phase, die mehrfach lief (Re-Run oder Auto-Progress), **When** der Verbrauch aufgeschlüsselt wird, **Then** werden alle Läufe dieser Phase korrekt summiert und nicht doppelt oder gar nicht gezählt.
3. **Given** Läufe ohne autoritative Nutzungsdaten, **When** ihr Verbrauch angezeigt wird, **Then** ist erkennbar, ob der Wert gemessen oder geschätzt ist.
4. **Given** nachgelagerte Läufe (verify, review, Konfliktauflösung) ohne zugeordnete Phase, **When** der Feature-Verbrauch aggregiert wird, **Then** werden diese dem Feature zugerechnet und gehen nicht verloren.

---

### User Story 2 - Token-Verbrauch durch smarte Kontext-Übergabe senken (Priority: P2)

Als Nutzer will ich, dass jede SDD-Phase nur den tatsächlich benötigten Kontext erhält — statt des vollständig akkumulierten Verlaufs aller Vorphasen — damit der Token-Verbrauch sinkt, ohne dass die erzeugten Artefakte (Spec, Plan, Tasks, implementierter Code) schlechter werden.

**Why this priority**: Die smarte Kontext-Übergabe ist der größte Hebel (der akkumulierende Sitzungs-Verlauf und das wiederholte Einlesen aller Vorartefakte wachsen mit jeder Phase). Setzt die Messbarkeit aus Story 1 voraus, um den Effekt zu belegen.

**Independent Test**: Dasselbe Referenz-Feature einmal mit und einmal ohne aktivierte smarte Kontext-Übergabe bauen (A/B, identische Messmethode) — der Lauf mit Optimierung verbraucht messbar weniger Tokens, während die Artefakte dieselben Qualitäts-Checklisten und dieselbe Verifikation bestehen.

**Acceptance Scenarios**:

1. **Given** dasselbe Referenz-Feature wird mit und ohne Optimierung gebaut, **When** die smarte Kontext-Übergabe aktiv ist, **Then** liegt der gemessene Gesamt-Tokenverbrauch messbar unter dem A/B-Lauf ohne Optimierung.
2. **Given** eine nachgelagerte Phase (z. B. tasks, implement), **When** sie startet, **Then** erhält sie den für sie relevanten Kontext (benötigte Vorartefakte und relevantes Projektwissen) und nicht den kompletten, unbearbeiteten Verlauf aller vorherigen Phasen.
3. **Given** die smarte Übergabe ist aktiv, **When** die Phase abgeschlossen ist, **Then** bestehen die Lieferartefakte dieselben Qualitäts-Gates wie ohne die Optimierung (keine Qualitätsminderung).
4. **Given** ein benötigtes Vorartefakt fehlt oder ist unvollständig, **When** eine Phase startet, **Then** fällt das System nachvollziehbar auf die vollständige Kontext-Übergabe zurück statt fehlerhaft mit Teilkontext zu arbeiten.

---

### User Story 3 - Signalarme Inhalte vor der Übergabe verdichten (Priority: P3)

Als Nutzer will ich, dass umfangreiche, signalarme Inhalte (z. B. verbose Logs, wiederholte Boilerplate, redundante Wiederholungen früherer Ausgaben) vor der Übergabe an eine Phase verdichtet oder zusammengefasst werden, damit weniger Tokens verbraucht werden — ohne dass für die jeweilige Phase entscheidungsrelevante Information verloren geht.

**Why this priority**: Zusätzlicher Hebel über die reine Kontext-Auswahl hinaus (die vom Nutzer angesprochenen Werkzeuge „wie caveman oder ähnliche"). Wertvoll, aber erst sinnvoll, wenn Messung (P1) und Kontext-Auswahl (P2) stehen; höheres Risiko für Qualitätsverlust, daher niedrigere Priorität.

**Independent Test**: Einen Lauf mit bewusst signalarmem/umfangreichem Input durchführen; prüfen, dass der übergebene Kontext verdichtet ist, alle für die Aufgabe relevanten Fakten erhalten bleiben und das Ergebnis in Qualität dem unverdichteten Lauf entspricht.

**Acceptance Scenarios**:

1. **Given** ein Kontext mit großen signalarmen Anteilen, **When** die Verdichtung aktiv ist, **Then** ist der an die Phase übergebene Kontext kleiner, und die für die Phase relevanten Informationen bleiben erhalten.
2. **Given** die Verdichtung entfernt Inhalte, **When** ein Lauf abgeschlossen ist, **Then** ist nachvollziehbar (auditierbar), welche Inhalte verdichtet/ausgelassen wurden.
3. **Given** die Verdichtung würde entscheidungsrelevante Information entfernen, **When** dies erkannt wird, **Then** unterbleibt die Verdichtung für diesen Inhalt bzw. das System fällt auf den vollständigen Inhalt zurück.

---

### Edge Cases

- **Nicht-autoritative Messwerte**: Für viele Phasen-Läufe liegen heute keine exakten Nutzungsdaten vor (nur Schätzung/Terminal-Extraktion). Wie wird verhindert, dass Baseline und Reduktionsnachweis auf unzuverlässigen Zahlen beruhen? → Herkunft ausweisen, Anteil belastbarer Werte erhöhen.
- **Mehrfachläufe pro Phase**: Re-Runs und Auto-Progress erzeugen mehrere Läufe je Phase — Aggregation darf weder doppeln noch verlieren.
- **Läufe ohne Phasenzuordnung**: verify/review/Konfliktauflösung werden dem Feature, aber keiner Phase zugeordnet — sie dürfen bei der Feature-Aggregation nicht durchfallen.
- **Qualitätsverlust durch Reduktion**: Reduktion darf Clarify-Rückfragen, Review-Gates und die Verifikations-Pipeline weder umgehen noch schwächen.
- **Über-Verdichtung**: Verdichtung, die relevante Information entfernt, muss erkannt und rückgängig gemacht werden (Rückfall auf vollständigen Inhalt).
- **LLM-Verdichtung ohne Netto-Ersparnis**: Bringt die optionale LLM-Verdichtung netto keine Ersparnis (eigene Aufrufkosten ≥ eingesparte Tokens), muss dies erkannt und die LLM-Verdichtung deaktiviert/übersprungen werden (Rückfall auf deterministische Verdichtung).
- **Läufe außerhalb des Reduktions-Scopes**: Chat-, verify-, review- und Konfliktauflösungs-Läufe werden weiterhin gemessen (P1), aber nicht reduziert — ihre Werte dürfen den A/B-Reduktionsnachweis der SDD-Phasen nicht verfälschen.
- **Vergleichbarkeit**: Da zwei verschiedene Features nie identisch groß sind, erfolgt der Reduktionsnachweis als A/B am **selben** Referenz-Feature (Optimierung an vs. aus); nicht-deterministische Streuung zwischen zwei Läufen muss berücksichtigt werden (z. B. Referenz-Feature mit stabilem, reproduzierbarem Ablauf wählen).
- **Reversibilität**: Optimierungen müssen abschaltbar sein, ohne dass Daten oder Funktion verloren gehen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS den Token-Verbrauch und die Kosten pro Feature erfassen und nach SDD-Phase aufschlüsseln, inklusive nachgelagerter Läufe (verify, review, Konfliktauflösung) und mehrfacher Läufe pro Phase.
- **FR-002**: Das System MUSS für jeden Verbrauchswert die Herkunft ausweisen (autoritativ gemessen vs. geschätzt), damit Baseline und Reduktionsnachweis belastbar interpretierbar sind.
- **FR-003**: Nutzer MÜSSEN den Ist-Verbrauch (Baseline) eines abgeschlossenen Features einsehen können, damit Optimierungen daran gemessen werden können.
- **FR-004**: Das System MUSS jeder SDD-Phase nur den für diese Phase relevanten Kontext bereitstellen (benötigte Vorartefakte und relevantes Projektwissen), statt des vollständig akkumulierten Verlaufs aller Vorphasen.
- **FR-005**: Das System MUSS umfangreiche, signalarme Inhalte vor der Übergabe verdichten können, ohne für die jeweilige Phase entscheidungsrelevante Information zu verlieren. Die Verdichtung erfolgt **standardmäßig deterministisch/lokal** (ohne Modellaufrufe); eine **LLM-basierte Verdichtung MUSS optional zuschaltbar** sein und darf nur aktiv bleiben, wenn der Gesamtverbrauch inklusive ihrer eigenen Aufrufe messbar unter der Baseline liegt.
- **FR-006**: Reduktionsmaßnahmen MÜSSEN die bestehenden Qualitäts-Gates (Spec-Qualitäts-Checkliste, Clarify, Review-Gate, Verifikations-Pipeline) unverändert durchlaufen — sie dürfen weder umgangen noch abgeschwächt werden.
- **FR-007**: Das System MUSS die erzielte Reduktion messbar machen — als **A/B-Vergleich am selben Feature** (Optimierung an vs. aus) mit identischer Messmethode, sodass der relative Verbrauchs-Delta auch bei geschätzten Absolutwerten belastbar ist.
- **FR-008**: Reduktionsmaßnahmen MÜSSEN umschaltbar (an/aus) sein, damit im Zweifel auf das unreduzierte Verhalten zurückgefallen werden kann, ohne Datenverlust.
- **FR-009**: Das System MUSS nachvollziehbar machen, welche Inhalte verdichtet oder ausgelassen wurden (Transparenz/Auditierbarkeit), damit ein möglicher Qualitätsverlust überprüfbar ist.
- **FR-010**: Das System MUSS bei fehlendem oder unvollständigem relevantem Kontext nachvollziehbar auf die vollständige Kontext-Übergabe zurückfallen, statt mit fehlerhaftem Teilkontext zu arbeiten.
- **FR-011**: Die Reduktionsmaßnahmen (FR-004, FR-005) gelten **ausschließlich für die SDD-Phasen-Läufe** (specify, clarify, plan, tasks, implement). Chat-, verify-, review- und Konfliktauflösungs-Läufe bleiben unverändert; die Erfassung und Aufschlüsselung (FR-001) umfasst jedoch weiterhin **alle** Lauf-Arten.

### Key Entities *(include if feature involves data)*

- **Feature-Verbrauch (Aggregat)**: Gesamt-Tokenverbrauch und -kosten eines Features, Aufschlüsselung nach Phase, Anteil gemessener vs. geschätzter Werte.
- **Phasen-Lauf (Execution)**: Einzelner Lauf mit Phase, Art (Phase/verify/review/Konfliktauflösung/Chat), Tokens, Kosten, Zeitpunkt, Herkunft des Verbrauchswerts (gemessen/geschätzt).
- **Baseline**: Erfasster Ist-Verbrauch eines Referenz-Features vor Optimierung, als Vergleichsmaßstab.
- **Kontext-Paket**: Der einer Phase übergebene Kontext (ausgewählte Vorartefakte + relevantes Projektwissen), optional in verdichteter Form, mit Nachweis der Auswahl/Verdichtung.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Im **A/B-Vergleich am selben Referenz-Feature** (einmal mit, einmal ohne Optimierung, identische Messmethode) sinkt der Gesamt-Tokenverbrauch um **mindestens 30 %** gegenüber dem Lauf ohne Optimierung (Baseline-Größenordnung ~97.400 Tokens).
- **SC-002**: Die Qualität der Lieferartefakte bleibt erhalten: **100 %** der Spec-Qualitäts-Checklisten-Items bestehen weiterhin, und Verifikations-Pipeline (Test/Build/Lint) sowie Review-Gates liefern dasselbe Ergebnis wie ohne Reduktion.
- **SC-003**: Nutzer können den nach Phase aufgeschlüsselten Token-/Kostenverbrauch eines Features in **unter 30 Sekunden** (wenige Klicks, ohne manuelles Zusammenrechnen) einsehen.
- **SC-004**: Für **jeden** angezeigten Verbrauchswert ist die Herkunft (gemessen/geschätzt) erkennbar, und der Anteil autoritativ gemessener Werte steigt gegenüber der Ausgangslage.
- **SC-005**: Reduktionsmaßnahmen sind ohne Datenverlust reversibel — das Abschalten stellt das ursprüngliche Verhalten und dieselben Artefakte-Ergebnisse wieder her.
- **SC-006**: Die stärksten Phasen (implement, plan) tragen den Großteil der absoluten Einsparung; ihr Verbrauch pro vergleichbarem Feature sinkt jeweils messbar gegenüber der Baseline.

## Assumptions

- Der bestehende Kosten-/Token-Zähler und die Ausführungs-Historie pro Feature/Phase dienen als Datengrundlage und werden für belastbarere Messung erweitert.
- „Ohne Qualitätsminderung" wird operationalisiert über die bereits vorhandenen Gates: Spec-Qualitäts-Checkliste, Clarify, Review-Gate und Verifikations-Pipeline (Test/Build/Lint) sowie ggf. menschliche Review.
- Der Reduktionsnachweis erfolgt per **A/B-Vergleich am selben Referenz-Feature** (Optimierung an vs. aus) mit identischer Messmethode; exakte Token-Zahlen sind heute teils geschätzt und werden als solche gekennzeichnet — der relative Verbrauchs-Delta bleibt dennoch belastbar.
- Das Reduktionsziel bezieht sich auf den Feature-Gesamtverbrauch der SDD-Phasen; ≥30 % ist der Zielwert für die erste Ausbaustufe (weitergehende Einsparung ist willkommen, sofern die Qualität gehalten wird).
- Reduktionsmaßnahmen (smarte Kontext-Übergabe, Verdichtung) betreffen **nur die SDD-Phasen-Läufe**; Projekt-Chat, verify, review und Konfliktauflösung sind für die Reduktion out-of-scope (Messung/Transparenz gilt weiterhin für alle Läufe).
- Konkrete Reduktionstechniken (Kontext-Auswahl, Verdichtungswerkzeuge „wie caveman oder ähnliche") werden in der Planungsphase festgelegt; die Spezifikation bleibt technikneutral. Verdichtung ist standardmäßig deterministisch/lokal; optionale LLM-Verdichtung ist zuschaltbar, aber nur mit nachgewiesener Netto-Ersparnis zulässig.
- Alle Optimierungen sind umschaltbar und standardmäßig sicher (bei Unsicherheit Rückfall auf vollständigen Kontext / unreduziertes Verhalten).
