let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function playTone(frequency: number, startTime: number, duration: number, volume: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  playTone(880, now, 0.15, 0.3);
  playTone(1100, now + 0.12, 0.18, 0.25);
  playTone(1320, now + 0.26, 0.2, 0.2);
}

export function playRegistrationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  playTone(660, now, 0.12, 0.25);
  playTone(880, now + 0.1, 0.15, 0.22);
  playTone(990, now + 0.22, 0.12, 0.18);
}

export function vibrate(pattern: number | number[] = [200, 100, 200]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore
    }
  }
}
