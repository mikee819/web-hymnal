declare module 'soundfont-player' {
  export type InstrumentName = string;

  export interface Player {
    play(name: string, when?: number, options?: {
      duration?: number;
      gain?: number;
      destination?: AudioNode;
      decay?: number;
      loop?: boolean;
    }): Player;
    stop(when?: number): void;
    listenToMidi(input: unknown): Player;
  }

  export interface Options {
    soundfont?: 'MusyngKite' | 'FluidR3_GM';
    format?: 'mp3' | 'ogg';
    destination?: AudioNode;
  }

  export function instrument(
    ac: AudioContext,
    name: InstrumentName,
    options?: Options
  ): Promise<Player>;
}