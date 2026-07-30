# Feature Specification: „Braucht dich" verschwindet nach Review nicht

**Feature Branch**: `feature/braucht-dich-verschwindet-nach-review-nicht`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Ein aufgelöstes Attention-Item bleibt in der Oberfläche stehen. In der Datenbank ist es aufgelöst (beobachtet: erstellt 10:38:48, gelöst 10:40:43, Feature merged) — es hängt nur in der Anzeige. Ein Reload räumt es weg, weil /api/state attention.listOpen() mitliefert (server.ts:170); daher wirkt es „manchmal". Zwei unabhängige Fehler in derselben Kette: (1) resolveFor() (db/repos.ts:720) ist ein reines DB-Update. Die Review-Pfade mergeQueueService.ts:354 und server.ts:813 feuern KEIN attention_resolved. Nur der Einzelpfad (server.ts:958, mergeQueueService.ts:732) emittiert — deshalb funktioniert manuelles Wegklicken, automatisches Auflösen nicht. (2) orchestrator.ts:394 sendet attention_resolved mit einer featureId, :633 mit einer session.id. Der Reducer filtert `a.id !== action.id && a.sessionId !== action.id` (web/store.tsx:162) — eine featureId passt auf keines von beiden, das Ereignis entfernt also nichts. Aufgabe: resolveFor() gibt die betroffenen Item-IDs zurück und emittiert pro ID. attention_resolved trägt ausschliesslich Item-IDs, nie featureId oder sessionId. Abnahme: Nach Freigabe und Merge verschwindet das Item ohne Reload. Reducer-Tests für beide bisherigen Fehlerfälle."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Die erledigte Meldung verschwindet von selbst (Priority: P1)

Ein Feature meldet sich mit „braucht dich — Review fällig". Der Nutzer gibt das Feature frei, die
Integration läuft durch und das Feature wird gemergt. Die Meldung in der „braucht dich"-Liste
verschwindet dabei von selbst, ohne dass der Nutzer die Seite neu laden oder die Meldung von Hand
wegklicken muss.

**Why this priority**: Das ist der gemeldete Fehler und der eigentliche Wert des Features. Heute
bleibt die Meldung nach Freigabe und Merge stehen, obwohl sie längst erledigt ist. Der Nutzer sieht
eine Aufforderung zu einer Handlung, die es nicht mehr gibt — und weiss nicht, ob die Anzeige
falsch ist oder das Feature wirklich noch etwas braucht. Weil ein Neuladen die Liste korrekt
aufräumt, wirkt der Fehler sporadisch und untergräbt das Vertrauen in die ganze Liste.

**Independent Test**: Vollständig testbar, indem ein Feature mit offener Review-Meldung freigegeben
und bis zum Merge durchgelassen wird, während die Oberfläche durchgehend offen bleibt und nicht neu
geladen wird — die Meldung muss ohne Zutun verschwinden.

**Acceptance Scenarios**:

1. **Given** ein Feature mit offener Meldung „Review fällig" und eine geöffnete, nicht neu geladene
   Oberfläche, **When** der Nutzer das Feature freigibt, **Then** verschwindet die Meldung aus der
   „braucht dich"-Liste, ohne dass neu geladen wird.
2. **Given** dasselbe Feature nach der Freigabe, **When** die Integration durchläuft und das Feature
   gemergt wird, **Then** ist und bleibt die Liste frei von Meldungen dieses Features, ohne dass neu
   geladen wird.
3. **Given** ein Feature mit offener Meldung „Review fällig", **When** der Nutzer das Review
   zurückweist, **Then** verschwindet die Review-Meldung ebenfalls sofort aus der Liste.
4. **Given** eine soeben automatisch verschwundene Meldung, **When** der Nutzer die Seite danach neu
   lädt, **Then** bleibt die Meldung verschwunden — Anzeige und gespeicherter Zustand stimmen
   überein.
5. **Given** eine offene Meldung, **When** der Nutzer sie wie bisher von Hand wegklickt, **Then**
   verschwindet sie unverändert sofort — das bisher funktionierende Verhalten bleibt erhalten.

---

### User Story 2 - Jeder automatische Auflöseweg räumt die Anzeige auf (Priority: P2)

Meldungen werden vom Toolkit an vielen Stellen automatisch erledigt — nicht nur nach Freigabe und
Merge: bei Zurückweisung eines Reviews, beim Wiederaufnehmen einer fehlgeschlagenen Integration,
nach Freigabe oder Verwerfen einer Phase, wenn ein wartender Agent wieder zu arbeiten beginnt, wenn
eine Session endet, und ebenso im Projekt-Chat. In allen diesen Fällen verschwindet die erledigte
Meldung ohne Neuladen aus der Anzeige.

**Why this priority**: Story 1 behebt den beobachteten Fall. Ohne diese Story bleibt dieselbe
Fehlerklasse an allen übrigen Stellen bestehen und die Liste bleibt sporadisch falsch — der Nutzer
kann ihr weiterhin nicht trauen. Zusätzlich ist die Story technisch bindend: sobald die Anzeige
Meldungen nur noch anhand der Kennung der Meldung selbst zuordnet, hören die Wege, die heute nur
über eine Session-Zuordnung zufällig funktionieren, auf zu funktionieren, wenn sie nicht
mitumgestellt werden. Sie muss also vollständig, nicht auszugsweise umgesetzt werden.

**Independent Test**: Vollständig testbar, indem für jeden automatischen Auflöseweg eine passende
Meldung erzeugt und der Weg ausgelöst wird — die Anzeige der offenen Meldungen muss danach dem
gespeicherten Zustand entsprechen, ohne Neuladen.

**Acceptance Scenarios**:

1. **Given** ein Feature mit offenen Meldungen zu einer fehlgeschlagenen Integration, **When** der
   Nutzer die Integration wieder aufnimmt, **Then** verschwinden diese Meldungen ohne Neuladen.
2. **Given** ein Feature mit einer offenen Meldung „Freigabe erforderlich" oder „Prüfschritt
   fehlgeschlagen", **When** der Nutzer die Phase freigibt, verwirft oder neu startet, **Then**
   verschwindet die Meldung ohne Neuladen.
3. **Given** eine Session mit offener Meldung „wartet auf Eingabe", **When** die Session wieder zu
   arbeiten beginnt, **Then** verschwindet die Meldung ohne Neuladen.
4. **Given** eine Session mit offener Meldung „wartet auf Eingabe", **When** die Session endet,
   **Then** verschwindet die Meldung ohne Neuladen.
5. **Given** eine offene Meldung aus dem Projekt-Chat, **When** der Chat weiterarbeitet oder die
   zugehörige Session endet, **Then** verschwindet die Meldung ohne Neuladen — der Chat-Pfad
   verhält sich hier identisch zum Feature-Pfad.
6. **Given** mehrere gleichzeitig offene Meldungen desselben Features oder derselben Session,
   **When** ein Auflöseweg sie gemeinsam erledigt, **Then** verschwinden **alle** betroffenen
   Meldungen, nicht nur eine.
7. **Given** einen Auflöseweg, der auf keine offene Meldung trifft, **When** er ausgelöst wird,
   **Then** verändert sich die Anzeige nicht und es tritt kein Fehler auf.

---

### User Story 3 - Der Fehler kann nicht unbemerkt zurückkehren (Priority: P3)

Beide Fehlerursachen sind durch automatisierte Tests abgedeckt: dass eine Auflösungs-Meldung mit der
Kennung der Meldung die betroffene Meldung tatsächlich aus der Anzeige entfernt, und dass eine
Auflösungs-Meldung mit einer fremden Kennung (Feature oder Session) nichts entfernt — weil solche
Kennungen nicht mehr vorkommen dürfen.

**Why this priority**: Der Fehler ist über Monate unentdeckt geblieben, weil ein Neuladen ihn
kaschiert und die Anzeige damit „meistens" richtig aussieht. Ohne Regressionsschutz ist die nächste
stille Wiederkehr wahrscheinlich. Der Wert ist real, aber er entsteht erst nach den Stories 1 und 2.

**Independent Test**: Vollständig testbar, indem die Tests gegen den heutigen Stand laufen — sie
müssen dort fehlschlagen — und gegen den neuen Stand erneut laufen, wo sie bestehen müssen.

**Acceptance Scenarios**:

1. **Given** eine angezeigte Liste offener Meldungen, **When** eine Auflösungs-Meldung mit der
   Kennung einer dieser Meldungen eintrifft, **Then** ist genau diese Meldung aus der Liste
   entfernt und alle übrigen bleiben unverändert stehen.
2. **Given** eine angezeigte Liste offener Meldungen, **When** eine Auflösungs-Meldung mit einer
   Feature- oder Session-Kennung statt einer Meldungs-Kennung eintrifft, **Then** bleibt die Liste
   unverändert — die Zuordnung erfolgt ausschliesslich über die Kennung der Meldung.
3. **Given** eine Sammel-Auflösung, die mehrere offene Meldungen betrifft, **When** sie ausgeführt
   wird, **Then** wird für jede betroffene Meldung genau eine Auflösungs-Meldung mit deren eigener
   Kennung ausgegeben.
4. **Given** eine Sammel-Auflösung, die auf keine offene Meldung trifft, **When** sie ausgeführt
   wird, **Then** wird keine Auflösungs-Meldung ausgegeben.

---

### Edge Cases

- **Meldung war schon erledigt**: Ein Auflöseweg trifft eine bereits aufgelöste Meldung — es wird
  keine erneute Auflösungs-Meldung ausgegeben, und die Anzeige bleibt unverändert.
- **Oberfläche gerade nicht verbunden**: Wird eine Meldung aufgelöst, während die Oberfläche nicht
  erreichbar ist, geht die Auflösungs-Meldung verloren. Beim nächsten Laden zeigt die Liste dennoch
  den korrekten Stand — das bestehende Sicherheitsnetz beim Laden bleibt bestehen und wird nicht
  ersetzt.
- **Auflösung einer nie angezeigten Meldung**: Trifft eine Auflösungs-Meldung für eine Meldung ein,
  die die Oberfläche gar nicht in ihrer Liste führt, bleibt die Liste unverändert und es tritt kein
  Fehler auf.
- **Mehrere Oberflächen gleichzeitig offen**: Jede offene Oberfläche entfernt dieselbe Meldung; es
  entsteht kein Zustand, in dem eine davon die Meldung behält.
- **Meldung wird unmittelbar nach der Auflösung neu erzeugt**: Die neue Meldung trägt eine eigene
  Kennung und bleibt sichtbar — die Auflösung der Vorgängerin darf sie nicht mitentfernen.
- **Gleichzeitige Auflösung und Neuladen**: Löst sich eine Meldung genau während eines Neuladens
  auf, ist das Ergebnis in beiden Fällen dasselbe — die Meldung ist weg, nicht doppelt vorhanden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Jede automatische Auflösung einer „braucht dich"-Meldung MUSS eine Auflösungs-Meldung
  an die Oberfläche ausgeben — unabhängig davon, ob eine einzelne Meldung oder mehrere Meldungen auf
  einmal aufgelöst werden.
- **FR-002**: Eine Sammel-Auflösung (alle Meldungen eines Features, einer Session oder einer
  Unterhaltung, ggf. auf bestimmte Arten eingegrenzt) MUSS die tatsächlich betroffenen Meldungen
  benennen und für **jede** von ihnen genau eine Auflösungs-Meldung ausgeben.
- **FR-003**: Eine Auflösungs-Meldung MUSS ausschliesslich die Kennung der aufgelösten Meldung
  tragen. Feature-Kennungen und Session-Kennungen sind als Inhalt einer Auflösungs-Meldung
  unzulässig.
- **FR-004**: Die Oberfläche MUSS eine Meldung ausschliesslich anhand deren eigener Kennung aus der
  Liste entfernen. Ein Abgleich über die Session-Zuordnung der Meldung entfällt.
- **FR-005**: Alle bestehenden automatischen Auflösewege MÜSSEN auf dieses Verhalten umgestellt
  werden — vollständig, nicht auszugsweise. Das umfasst mindestens: Freigabe eines Reviews,
  Zurückweisung eines Reviews, Abschluss nach dem Merge, Wiederaufnahme einer fehlgeschlagenen
  Integration, Freigabe/Verwerfen/Neustart einer Phase, Wiederaufnahme der Arbeit einer wartenden
  Session, Ende einer Session sowie die entsprechenden Wege im Projekt-Chat.
- **FR-006**: Löst eine Sammel-Auflösung keine Meldung auf, MUSS sie ohne Auflösungs-Meldung und
  ohne Fehler enden.
- **FR-007**: Das manuelle Wegklicken einer einzelnen Meldung MUSS unverändert weiterfunktionieren.
- **FR-008**: Die bestehenden Sicherheitsnetze beim Laden — die Liste offener Meldungen wird beim
  Laden der Oberfläche und beim gezielten Abruf mitgeliefert und dabei gegen den tatsächlichen
  Zustand abgeglichen — MÜSSEN erhalten bleiben. Die neuen Auflösungs-Meldungen ergänzen sie, sie
  ersetzen sie nicht.
- **FR-009**: Das Erzeugen von Meldungen, deren Entdopplung und die bestehenden Regeln, welche
  Meldungsart zu welchem Zustand passt, MÜSSEN unverändert bleiben.
- **FR-010**: Für beide bisherigen Fehlerursachen MUSS je ein automatisierter Test bestehen: (a) die
  Zuordnung über die Kennung der Meldung entfernt genau diese Meldung, (b) eine Auflösungs-Meldung
  mit einer fremden Kennung entfernt nichts. Beide Tests MÜSSEN gegen den heutigen Stand
  fehlschlagen.
- **FR-011**: Zusätzlich MUSS automatisiert geprüft sein, dass eine Sammel-Auflösung pro betroffener
  Meldung genau eine Auflösungs-Meldung ausgibt.

### Key Entities

- **„Braucht dich"-Meldung**: Ein Eintrag der Aufmerksamkeitsliste. Trägt eine eigene, eindeutige
  Kennung, eine Art (z.B. „Review fällig", „wartet auf Eingabe", „Prüfschritt fehlgeschlagen"),
  einen Text sowie Zuordnungen zu Projekt, Feature, Session und Unterhaltung. Sie ist entweder offen
  oder aufgelöst.
- **Auflösungs-Meldung**: Die Mitteilung an die Oberfläche, dass eine bestimmte Meldung erledigt
  ist. Ihr einziger Inhalt ist die Kennung dieser einen Meldung.
- **Auflöseweg**: Ein Vorgang im Toolkit, der eine oder mehrere Meldungen als erledigt markiert —
  entweder gezielt eine einzelne oder gesammelt alle Meldungen eines Features, einer Session oder
  einer Unterhaltung.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nach Freigabe und abgeschlossenem Merge verschwindet die Review-Meldung in 10 von 10
  Durchläufen ohne Neuladen aus der Anzeige.
- **SC-002**: Über alle in FR-005 genannten Auflösewege hinweg stimmt die angezeigte Liste offener
  Meldungen nach dem Auslösen jedes Weges vollständig mit dem gespeicherten Zustand überein —
  geprüft ohne Neuladen, ohne Abweichung.
- **SC-003**: Zwischen dem Erledigen einer Meldung und ihrem Verschwinden aus der Anzeige liegt
  weniger als eine Sekunde; für den Nutzer wirkt es unmittelbar.
- **SC-004**: Das manuelle Wegklicken einer Meldung funktioniert in 10 von 10 Durchläufen
  unverändert.
- **SC-005**: Beide in FR-010 beschriebenen Fehlerursachen sind durch je einen automatisierten Test
  abgedeckt, der gegen den heutigen Stand fehlschlägt und gegen den neuen besteht.
- **SC-006**: Kein Auflöseweg markiert Meldungen als erledigt, ohne dies der Oberfläche mitzuteilen
  — nachweisbar dadurch, dass jeder Weg mindestens eine Auflösungs-Meldung pro betroffener Meldung
  ausgibt.

## Assumptions

- Die Oberfläche erhält Auflösungen weiterhin über den bestehenden Ereigniskanal; es wird kein
  neuer Übertragungsweg eingeführt.
- Die Sicherheitsnetze beim Laden bleiben als Rückfallebene bestehen (verlorene Ereignisse bei
  unterbrochener Verbindung). Sie sind ausdrücklich nicht der reguläre Weg, über den Meldungen
  verschwinden.
- Der Umfang umfasst alle bestehenden automatischen Auflösewege, nicht nur die beiden beobachteten.
  Das ist keine Ausweitung des Auftrags, sondern Voraussetzung: sobald die Zuordnung über die
  Session-Kennung entfällt, hören die Wege, die heute nur darüber funktionieren, ohne Umstellung auf
  zu funktionieren.
- Der Projekt-Chat wird ausdrücklich mit umgestellt. Er hat in der Vergangenheit wiederholt
  Korrekturen des Feature-Pfads nicht mitbekommen; hier ist er zudem aus demselben Grund wie oben
  bindend.
- Für die geforderten Prüfungen der Anzeige-Logik existiert im Oberflächen-Teil des Projekts heute
  keine Testinfrastruktur. Ob dort eine geschaffen wird oder die zu prüfende Logik an eine bereits
  getestete Stelle wandert, ist eine Entscheidung der Planungsphase — die Prüfung selbst ist in
  jedem Fall gefordert.
- Aussehen, Sortierung und Inhalt der „braucht dich"-Liste bleiben unverändert; dieses Feature
  betrifft ausschliesslich das Verschwinden erledigter Einträge.

## Out of Scope

- Neue Meldungsarten, geänderte Meldungstexte oder geänderte Auslösebedingungen.
- Darstellung, Sortierung, Gruppierung oder Filterung der „braucht dich"-Liste.
- System-Benachrichtigungen ausserhalb der Anwendung.
- Nachträgliche Bereinigung von Meldungen, die vor diesem Feature entstanden sind — das bestehende
  Sicherheitsnetz beim Laden deckt sie ab.
