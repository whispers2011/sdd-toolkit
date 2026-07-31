# Specification Quality Checklist: Chat- und Phasen-Pfad — gemeinsamer Kern

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-30
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Zwei bewusste Abweichungen von der reinen Lehre, beide dem Gegenstand geschuldet:

1. **Namen aus dem Quellcode im Abschnitt „Das Problem in Zahlen" und in „Out of Scope".**
   Der Gegenstand dieses Features ist die Struktur des Quellcodes selbst. Die doppelten
   Fundstellen zu benennen ist hier Befund, nicht Vorgabe — sie sagen, *was heute doppelt ist*,
   nicht, *wie der gemeinsame Kern zu bauen ist*. Alle Anforderungen (FR-001…FR-020) und alle
   Erfolgskriterien sind ergebnisorientiert formuliert und schreiben keine Struktur vor.

2. **„Nicht-technische Stakeholder" gibt es bei diesem Feature nicht.** Die Nutzer sind die
   Entwickler des Toolkits und die Menschen, die seinen Kosten- und Verbrauchszahlen glauben
   müssen. Der Text ist entsprechend für sie geschrieben und meidet trotzdem Fachjargon, wo
   Alltagssprache trägt (Arbeitskopie statt Worktree, Meldungen der CLI statt Telemetrie-Events).

**Geklärt am 30.07.2026:** Die Abnahme (drei Aufgaben) und die Begründung (vier Verbesserungen,
von denen der Chat keine hat) reichten an genau einer Stelle unterschiedlich weit — dem
Zuordnungswächter. Entscheidung des Nutzers: bei den drei Aufgaben bleiben. FR-020 schliesst die
Ausdehnung auf Chat-Sessions ausdrücklich aus; „Out of Scope" nennt den technischen Grund (der
Chat verbucht atomar beim Turn-Abschluss und hat gar kein offenes Lauffenster, das der Wächter
prüfen könnte) und merkt sie zusammen mit `handleExit`/`handleStatusChange` als Folge-Feature vor.
