import { useState } from 'react';
import {
  MAX_SPEECH_LENGTH,
  SOUND_TRIGGERS,
  TONES,
  DEFAULT_TONE_ID,
  type SoundReaction,
  type SoundTrigger,
  type SoundTriggerId,
} from '@sdd/shared';
import { getPersonal, patchPersonal, usePersonal } from '../personalSettings.js';
import { previewReaction, type PreviewResult } from '../sound.js';
import { THEMES, setTheme, useTheme } from '../theme.js';
import { Dialog } from './Sidebar.js';

/**
 * Einstellungsbereich „Individuelle Einstellungen" (Contract U6): nutzerweit,
 * projektübergreifend. Drei Abschnitte in fester Reihenfolge — Signaltöne,
 * Darstellung, Vorauswahl Ticket-Quelle (U6.1).
 */
export function PersonalSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Individuelle Einstellungen" onClose={onClose} wide>
      <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
        <Section title="Signaltöne">
          <SoundSection />
        </Section>
        <Section title="Darstellung">
          <ThemeSection />
        </Section>
        <Section title="Vorauswahl Ticket-Quelle">
          <TicketSourceSection />
        </Section>
      </div>
    </Dialog>
  );
}

// ---------- Signaltöne (U6.2 – U6.6) ----------

const GROUP_LABELS: Record<SoundTrigger['group'], string> = {
  attention: 'Aufmerksamkeit',
  flow: 'Ablauf',
  phase: 'Phasen',
};

const GROUP_ORDER: SoundTrigger['group'][] = ['attention', 'flow', 'phase'];

function SoundSection() {
  const { sound } = usePersonal();

  const setSound = (patch: Partial<typeof sound>) =>
    void patchPersonal({ sound: { ...getPersonal().sound, ...patch } }).catch(() => {
      /* Fehler meldet der Einstellungs-Client sichtbar */
    });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={sound.enabled}
            onChange={(e) => setSound({ enabled: e.target.checked })}
            className="accent-emerald-600"
          />
          Signaltöne abspielen
        </label>
        <label className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="w-28 shrink-0">Grundlautstärke</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sound.volume}
            onChange={(e) => setSound({ volume: Number(e.target.value) })}
            className="flex-1 accent-emerald-600"
          />
          <span className="w-10 shrink-0 text-right tabular-nums">
            {Math.round(sound.volume * 100)}%
          </span>
        </label>
        <p className="text-xs text-zinc-600">
          Der Hauptschalter lässt die Zuordnungen unten unverändert — nach dem Wiedereinschalten
          klingt alles wie zuvor.
        </p>
      </div>

      {GROUP_ORDER.map((group) => (
        <div key={group}>
          <h4 className="mb-1 text-xs font-medium text-zinc-500">{GROUP_LABELS[group]}</h4>
          <ul className="space-y-1">
            {SOUND_TRIGGERS.filter((t) => t.group === group).map((trigger) => (
              <TriggerRow key={trigger.id} trigger={trigger} reaction={sound.reactions[trigger.id]} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type ReactionKind = SoundReaction['kind'];

function kindOf(r: SoundReaction | undefined): ReactionKind {
  return r?.kind ?? 'silence';
}

/**
 * Eine Zeile je Auslöser: Auswahl „Stille / Ton / Ansage", der zugehörige
 * Zusatz (Tonliste bzw. Textfeld) und der Vorhör-Knopf (U6.3).
 */
function TriggerRow({
  trigger,
  reaction,
}: {
  trigger: SoundTrigger;
  reaction: SoundReaction | undefined;
}) {
  const [meldung, setMeldung] = useState<string | null>(null);
  const kind = kindOf(reaction);

  /** Die gesamte Karte wird ersetzt — deshalb hier neu aufbauen (A2.2). */
  const schreibe = (naechste: SoundReaction | undefined) => {
    const aktuell = getPersonal().sound;
    const reactions: Partial<Record<SoundTriggerId, SoundReaction>> = { ...aktuell.reactions };
    if (naechste === undefined) delete reactions[trigger.id];
    else reactions[trigger.id] = naechste;
    setMeldung(null);
    void patchPersonal({ sound: { ...aktuell, reactions } }).catch(() => {
      /* Fehler meldet der Einstellungs-Client sichtbar */
    });
  };

  const wechsle = (naechste: ReactionKind) => {
    if (naechste === 'silence') return schreibe(undefined);
    if (naechste === 'tone') {
      return schreibe({ kind: 'tone', toneId: reaction?.kind === 'tone' ? reaction.toneId : DEFAULT_TONE_ID });
    }
    return schreibe({ kind: 'speech', text: reaction?.kind === 'speech' ? reaction.text : '' });
  };

  /**
   * Vorhören spielt den AKTUELL in der Auswahl stehenden Wert — nicht den
   * gespeicherten und ohne zu speichern (U6.4). Weil jede Änderung sofort
   * geschrieben wird, sind beide hier ohnehin identisch; entscheidend ist, dass
   * kein Speichern-Schritt nötig ist.
   */
  const vorhoeren = () => {
    const aktuell: SoundReaction = reaction ?? { kind: 'silence' };
    setMeldung(null);
    void previewReaction(aktuell, trigger.label).then((r: PreviewResult) => {
      if (r.ok) return;
      setMeldung(
        r.reason === 'audio_blocked'
          ? 'Tonausgabe ist blockiert — einmal ins Fenster klicken und erneut versuchen.'
          : 'Keine Sprachausgabe verfügbar — dieser Browser hat keine Stimme installiert.',
      );
    });
  };

  return (
    <li className="rounded border border-zinc-800 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-44 flex-1 text-sm text-zinc-300">{trigger.label}</span>

        <select
          value={kind}
          onChange={(e) => wechsle(e.target.value as ReactionKind)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
        >
          <option value="silence">Stille</option>
          <option value="tone">Ton</option>
          <option value="speech">Ansage</option>
        </select>

        {kind === 'tone' && (
          <select
            value={reaction?.kind === 'tone' ? reaction.toneId : DEFAULT_TONE_ID}
            onChange={(e) => schreibe({ kind: 'tone', toneId: e.target.value })}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          >
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}

        {kind === 'speech' && (
          <input
            value={reaction?.kind === 'speech' ? reaction.text : ''}
            onChange={(e) => schreibe({ kind: 'speech', text: e.target.value })}
            maxLength={MAX_SPEECH_LENGTH}
            placeholder={trigger.label}
            className="min-w-40 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          />
        )}

        <button
          onClick={vorhoeren}
          disabled={kind === 'silence'}
          title={kind === 'silence' ? 'Stille lässt sich nicht vorhören' : 'Vorhören'}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
        >
          ▶ Vorhören
        </button>
      </div>

      {kind === 'speech' && (
        <p className="mt-1 text-xs text-zinc-600">
          Ohne Text wird die Bezeichnung des Auslösers gesprochen.
        </p>
      )}
      {trigger.hint && <p className="mt-1 text-xs text-zinc-600">{trigger.hint}</p>}
      {meldung && <p className="mt-1 text-xs text-amber-400">{meldung}</p>}
    </li>
  );
}

// ---------- Darstellung (U6.7) ----------

/**
 * Farbdesign: wirkt sofort über `setTheme` — ohne Speichern-Knopf, ohne
 * Neuladen und ohne Serverweg. Die Wahl bleibt gerätelokal (U1.6), deshalb
 * läuft sie bewusst NICHT über `patchPersonal`.
 */
function ThemeSection() {
  const aktiv = useTheme();
  return (
    <div className="space-y-1">
      {THEMES.map((t) => (
        <label
          key={t.id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          <input
            type="radio"
            name="sdd-theme"
            checked={aktiv === t.id}
            onChange={() => setTheme(t.id)}
            className="accent-emerald-600"
          />
          {t.label}
        </label>
      ))}
      <p className="px-2 pt-1 text-xs text-zinc-600">
        Gilt für dieses Gerät. Der Umschalter oben rechts schaltet durch dieselben Designs.
      </p>
    </div>
  );
}

// ---------- Vorauswahl Ticket-Quelle (U6.8) ----------

function TicketSourceSection() {
  const { ticketSource } = usePersonal();
  const waehle = (quelle: 'jira' | 'manual') =>
    void patchPersonal({ ticketSource: quelle }).catch(() => {
      /* Fehler meldet der Einstellungs-Client sichtbar */
    });

  return (
    <div className="space-y-1">
      {(
        [
          ['jira', 'Aus Jira importieren'],
          ['manual', 'Manuell erfassen'],
        ] as const
      ).map(([id, label]) => (
        <label
          key={id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          <input
            type="radio"
            name="sdd-ticket-source"
            checked={ticketSource === id}
            onChange={() => waehle(id)}
            className="accent-emerald-600"
          />
          {label}
        </label>
      ))}
      <p className="px-2 pt-1 text-xs text-zinc-600">
        Ohne Jira-Verbindung öffnet „Neues Feature" immer die manuelle Erfassung — die Einstellung
        bleibt dabei unverändert.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 border-b border-zinc-800 pb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
