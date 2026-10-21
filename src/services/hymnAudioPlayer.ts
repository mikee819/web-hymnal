import { Midi } from '@tonejs/midi';
import Soundfont from 'soundfont-player';

export type PartName = 'full' | 'soprano' | 'alto' | 'tenor' | 'bass';

const PART_VOICE_MAP: Record<PartName, Soundfont.InstrumentName> = {
  soprano: 'choir_aahs',
  alto: 'choir_aahs',
  tenor: 'choir_aahs',
  bass: 'choir_aahs',
  full: 'choir_aahs',
};

// Major triad step sequences relative to DO
const SOLFEGE_STEP_SEQUENCES: Record<string, number[]> = {
  DO: [0],
  MI: [0, 4],
  SO: [0, 4, 7],
  SOL: [0, -5], // Step DOWN a 4th
  'OCTAVE DO': [0, 4, 7, 12],
  'HIGH DO': [0, 4, 7, 12],
};

function noteToMidi(noteName: string): number {
  const match = noteName.trim().match(/^([A-Ga-g])([b#]?)(-?\d+)?$/);
  if (!match) return 60;

  const baseNote = match[1].toUpperCase();
  const accidental = match[2] || '';
  const octave = match[3] !== undefined ? parseInt(match[3], 10) : 4;

  const semitoneMap: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  let semitones = semitoneMap[baseNote] || 0;
  if (accidental === '#') semitones += 1;
  else if (accidental === 'b') semitones -= 1;

  return 12 * (octave + 1) + semitones;
}

function midiToFrequency(midiNumber: number): number {
  return 440 * Math.pow(2, (midiNumber - 69) / 12);
}

interface ScheduledNote {
  name: string;
  time: number;
  duration: number;
  velocity: number;
}

interface PartChannel {
  gainNode: GainNode;
  notes: ScheduledNote[];
  instrument: Soundfont.Player | null;
  isActive: boolean;
  volume: number;
}

export class HymnAudioPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private channels: Map<PartName, PartChannel> = new Map();
  private isPlaying: boolean = false;
  private startTime: number = 0;
  private pauseOffset: number = 0;
  private timerId: number | null = null;

  private loopDuration: number = 0;
  private lastScheduledWindowEnd: number = 0;

  private readonly LOOKAHEAD_MS = 25;
  private readonly SCHEDULE_AHEAD_SEC = 0.2;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
  }

  private async getVoiceInstrument(
    name: Soundfont.InstrumentName,
    destination: AudioNode
  ): Promise<Soundfont.Player> {
    this.initContext();
    return await Soundfont.instrument(this.ctx!, name, {
      soundfont: 'MusyngKite',
      soundfontUrl: `${import.meta.env.BASE_URL}audio/soundfonts/MusyngKite/`,
      from: `${import.meta.env.BASE_URL}audio/soundfonts/MusyngKite/`,
      format: 'mp3',
      destination,
    } as any);
  }

  async loadHymnTracks(trackUrls: Partial<Record<PartName, string>>) {
    this.initContext();
    this.stop();
    this.channels.clear();

    const partsPresent = Object.keys(trackUrls) as PartName[];
    let maxNoteEndTime = 0;
    let bpm = 100;
    let beatsPerBar = 4;

    const loadPromises = partsPresent.map(async (part) => {
      const url = trackUrls[part]!;
      const voicePreset = PART_VOICE_MAP[part];

      const gain = this.ctx!.createGain();
      gain.connect(this.masterGain!);

      const [midiResp, instrument] = await Promise.all([
        fetch(url),
        this.getVoiceInstrument(voicePreset, gain),
      ]);

      const arrayBuffer = await midiResp.arrayBuffer();
      const midi = new Midi(arrayBuffer);

      if (midi.header.tempos.length > 0) {
        bpm = midi.header.tempos[0].bpm;
      }
      if (midi.header.timeSignatures.length > 0) {
        beatsPerBar = midi.header.timeSignatures[0].timeSignature[0] || 4;
      }

      const flatNotes: ScheduledNote[] = [];
      midi.tracks.forEach((t) => {
        t.notes.forEach((n) => {
          const noteEnd = n.time + n.duration;
          if (noteEnd > maxNoteEndTime) maxNoteEndTime = noteEnd;

          flatNotes.push({
            name: n.name,
            time: n.time,
            duration: n.duration,
            velocity: n.velocity,
          });
        });
      });
      flatNotes.sort((a, b) => a.time - b.time);

      this.channels.set(part, {
        gainNode: gain,
        notes: flatNotes,
        instrument,
        isActive: part === 'full' || (!trackUrls.full && part === 'soprano'),
        volume: 0.8,
      });
    });

    await Promise.all(loadPromises);

    const secondsPerBeat = 60 / bpm;
    const barDuration = secondsPerBeat * beatsPerBar;

    if (barDuration > 0 && maxNoteEndTime > 0) {
      const totalBars = Math.ceil(maxNoteEndTime / barDuration);
      this.loopDuration = totalBars * barDuration;
    } else {
      this.loopDuration = maxNoteEndTime || 30;
    }

    this.recomputeGains();
  }

  public setActiveParts(activeParts: PartName[]) {
    this.channels.forEach((ch, part) => {
      ch.isActive = activeParts.includes(part);
    });
    this.recomputeGains();
  }

  private recomputeGains() {
    if (!this.ctx) return;
    this.channels.forEach((ch) => {
      const targetGain = ch.isActive ? ch.volume : 0;
      ch.gainNode.gain.cancelScheduledValues(this.ctx!.currentTime);
      ch.gainNode.gain.setTargetAtTime(targetGain, this.ctx!.currentTime, 0.02);
    });
  }

  private scheduleLoop = () => {
    if (!this.isPlaying || !this.ctx || this.loopDuration <= 0) return;

    const currentTime = this.ctx.currentTime;
    const elapsed = currentTime - this.startTime;
    const windowEnd = elapsed + this.SCHEDULE_AHEAD_SEC;

    const fromTime = this.lastScheduledWindowEnd;
    const toTime = windowEnd;

    this.channels.forEach((ch) => {
      const player = ch.instrument;
      if (!player || !ch.isActive) return;

      ch.notes.forEach((note) => {
        const minIteration = Math.floor((fromTime - note.time) / this.loopDuration);
        const maxIteration = Math.floor((toTime - note.time) / this.loopDuration);

        for (let iter = minIteration; iter <= maxIteration; iter++) {
          if (iter < 0) continue;
          const absoluteNoteTime = iter * this.loopDuration + note.time;

          if (absoluteNoteTime >= fromTime && absoluteNoteTime < toTime) {
            const audioCtxScheduleTime = this.startTime + absoluteNoteTime;
            if (audioCtxScheduleTime >= currentTime - 0.05) {
              player.play(note.name, audioCtxScheduleTime, {
                duration: note.duration,
                gain: note.velocity,
                destination: ch.gainNode,
              });
            }
          }
        }
      });
    });

    this.lastScheduledWindowEnd = toTime;
    this.timerId = window.setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
  };

  /**
   * Sound leader pitch cue:
   * 1. Blows Tonic on pitch pipe (C4 to B4).
   * 2. Steps through the tonic triad directly to the target solfege starting note.
   */
  public async playPitchCue(keyNameOrNote: string, solfege?: string) {
    this.initContext();
    if (this.ctx!.state === 'suspended') {
      await this.ctx!.resume();
    }

    const cleanedNote = keyNameOrNote.replace(/[^A-Ga-g#b]/g, '');
    let baseMidi = noteToMidi(`${cleanedNote}4`);

    // Standard 13-note pitch pipe compass (C4 to B4, MIDI 60-71)
    while (baseMidi < 60) baseMidi += 12;
    while (baseMidi > 71) baseMidi -= 12;

    const upperSolfege = (solfege || 'DO').toUpperCase().trim();
    const offsets = SOLFEGE_STEP_SEQUENCES[upperSolfege] || [0];

    const now = this.ctx!.currentTime;

    const soundTone = (midi: number, startTime: number, duration: number, peakGain: number = 0.35) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(midiToFrequency(midi), startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.04);
      gain.gain.setValueAtTime(peakGain, startTime + duration - 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    let stepDelay = 0;
    offsets.forEach((offset, idx) => {
      const isFinal = idx === offsets.length - 1;
      const duration = isFinal ? 1.0 : 0.6;
      soundTone(baseMidi + offset, now + stepDelay, duration);
      stepDelay += isFinal ? 1.0 : 0.55;
    });
  }

  public async play() {
    this.initContext();
    if (this.ctx!.state === 'suspended') {
      await this.ctx!.resume();
    }

    this.startTime = this.ctx!.currentTime - this.pauseOffset;
    this.lastScheduledWindowEnd = Math.max(0, this.pauseOffset);
    this.isPlaying = true;

    this.scheduleLoop();
  }

  public pause() {
    if (!this.isPlaying || !this.ctx) return;
    this.pauseOffset = (this.ctx.currentTime - this.startTime) % (this.loopDuration || 1);
    this.cleanupScheduler();
    this.killAllNotes();
    this.isPlaying = false;
  }

  public stop() {
    this.pauseOffset = 0;
    this.lastScheduledWindowEnd = 0;
    this.cleanupScheduler();
    this.killAllNotes();
    this.isPlaying = false;
  }

  private cleanupScheduler() {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private killAllNotes() {
    this.channels.forEach((ch) => {
      ch.instrument?.stop();
    });
  }

  public get running() {
    return this.isPlaying;
  }
}

export const audioPlayer = new HymnAudioPlayer();
