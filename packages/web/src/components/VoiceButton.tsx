import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/* Minimale Web-Speech-Typen (nicht in lib.dom enthalten). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function voiceProvider(): 'webspeech' | 'api' {
  return localStorage.getItem('sdd-voice-provider') === 'api' ? 'api' : 'webspeech';
}
export function setVoiceProvider(p: 'webspeech' | 'api'): void {
  localStorage.setItem('sdd-voice-provider', p);
}
export function voiceLang(): string {
  return localStorage.getItem('sdd-voice-lang') ?? 'de-CH';
}
export function setVoiceLang(lang: string): void {
  localStorage.setItem('sdd-voice-lang', lang);
}

/**
 * Voice-Eingabe (WP15, WhisperM8-Diktat-Kern in Web-Form):
 * Web Speech API (zero-config) oder MediaRecorder → /api/transcribe (Whisper/Groq).
 */
export function VoiceButton({
  onText,
  hotkey = false,
  className = '',
}: {
  onText: (text: string) => void;
  /** ⌘⇧M zum Starten/Stoppen registrieren. */
  hotkey?: boolean;
  className?: string;
}) {
  const { dispatch } = useStore();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRef = useRef<{ recorder: MediaRecorder; chunks: Blob[] } | null>(null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  const fail = (message: string) => dispatch({ type: 'error', message });

  const stop = () => {
    recognitionRef.current?.stop();
    mediaRef.current?.recorder.stop();
    setRecording(false);
  };

  const start = async () => {
    if (voiceProvider() === 'webspeech') {
      const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Ctor) {
        fail('Web Speech API nicht verfügbar — konfiguriere Whisper/Groq im Automation-Menü.');
        return;
      }
      const rec = new Ctor();
      rec.lang = voiceLang();
      rec.continuous = true;
      rec.interimResults = false; // nur finale Chunks weitergeben
      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i]!;
          if (r.isFinal) onText(r[0].transcript.trim() + ' ');
        }
      };
      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') fail(`Spracherkennung: ${e.error}`);
        setRecording(false);
      };
      rec.onend = () => setRecording(false);
      recognitionRef.current = rec;
      rec.start();
      setRecording(true);
      return;
    }

    // API-Provider: aufnehmen, bei Stopp transkribieren.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        const form = new FormData();
        form.append('file', new Blob(chunks, { type: 'audio/webm' }), 'aufnahme.webm');
        fetch('/api/transcribe', { method: 'POST', body: form })
          .then(async (res) => {
            if (!res.ok) throw new Error((await res.text()).slice(0, 200));
            return res.json() as Promise<{ text: string }>;
          })
          .then((r) => r.text && onText(r.text.trim() + ' '))
          .catch((e: Error) => fail(`Transkription: ${e.message}`))
          .finally(() => setBusy(false));
      };
      mediaRef.current = { recorder, chunks };
      recorder.start();
      setRecording(true);
    } catch {
      fail('Mikrofon-Zugriff verweigert.');
    }
  };

  const toggle = () => (recordingRef.current ? stop() : void start());

  useEffect(() => {
    if (!hotkey) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkey]);

  useEffect(() => () => stop(), []); // Aufräumen beim Unmount

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={`Voice-Eingabe (⌘⇧M) — ${voiceProvider() === 'webspeech' ? 'Web Speech' : 'Whisper/Groq'}`}
      className={`rounded px-2 py-1 text-sm transition-colors ${
        recording
          ? 'animate-pulse bg-red-900 text-red-200'
          : busy
            ? 'bg-zinc-800 text-zinc-500'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
      } ${className}`}
    >
      {busy ? '…' : recording ? '⏹' : '🎙'}
    </button>
  );
}
