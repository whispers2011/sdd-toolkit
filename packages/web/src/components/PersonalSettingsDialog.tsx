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
        <Section title="Signaltöne" />
        <Section title="Darstellung">
          <ThemeSection />
        </Section>
        <Section title="Vorauswahl Ticket-Quelle" />
      </div>
    </Dialog>
  );
}

/**
 * Farbdesign (U6.7): wirkt sofort über `setTheme` — ohne Speichern-Knopf, ohne
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
