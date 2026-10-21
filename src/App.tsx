import { useState, useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import { Search, Music, ArrowLeft, Mic, Play, Pause, Square, Loader2, Volume2 } from 'lucide-react';
import { audioPlayer, type PartName } from './services/hymnAudioPlayer';

interface HymnIndexEntry {
  id: string;
  number: number | string | null;
  title: string;
  firstLine: string;
  hasAudio: boolean;
}

interface HymnSection {
  type: 'verse' | 'chorus';
  number?: number;
  lines: string[];
}

export interface PitchInfo {
  raw: string;
  key?: string;
  note: string;
  beat?: number | null;
  solfege: string;
}

interface HymnDetail {
  id: string;
  number: number | string | null;
  title: string;
  firstLine: string;
  pitchInfo?: PitchInfo;
  thematicRef?: string | null;
  sections: HymnSection[];
  tracks: Partial<Record<PartName, string>>;
}

const SATB_PARTS: PartName[] = ['soprano', 'alto', 'tenor', 'bass'];

export default function App() {
  const [catalog, setCatalog] = useState<HymnIndexEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHymnId, setSelectedHymnId] = useState<string | null>(null);
  const [hymnDetail, setHymnDetail] = useState<HymnDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Audio UI states
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [activeParts, setActiveParts] = useState<PartName[]>(['full']);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/hymns-index.json`)
      .then((res) => res.json())
      .then((data) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load hymnal index:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    audioPlayer.stop();
    setIsPlaying(false);

    if (!selectedHymnId) {
      setHymnDetail(null);
      return;
    }

    fetch(`${import.meta.env.BASE_URL}data/hymns/${selectedHymnId}.json`)
      .then((res) => res.json())
      .then(async (data: HymnDetail) => {
        setHymnDetail(data);

        const initialParts: PartName[] = data.tracks.full ? ['full'] : (Object.keys(data.tracks) as PartName[]);
        setActiveParts(initialParts);

        if (data.tracks && Object.keys(data.tracks).length > 0) {
          setAudioLoading(true);
          try {
            const resolvedTracks: Partial<Record<PartName, string>> = Object.fromEntries(
              Object.entries(data.tracks).map(([part, path]) => [
                part,
                `${import.meta.env.BASE_URL}${typeof path === 'string' ? path.replace(/^\/+/, '') : path}`,
              ])
            );

            await audioPlayer.loadHymnTracks(resolvedTracks);
            audioPlayer.setActiveParts(initialParts);
          } catch (err) {
            console.error('Failed to load audio tracks:', err);
          } finally {
            setAudioLoading(false);
          }
        }
      })
      .catch((err) => console.error('Failed to load hymn details:', err));
  }, [selectedHymnId]);

  const handleTogglePlay = () => {
    if (audioLoading) return;

    if (isPlaying) {
      audioPlayer.pause();
      setIsPlaying(false);
    } else {
      audioPlayer.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    audioPlayer.stop();
    setIsPlaying(false);
  };

  const handlePartClick = (clickedPart: PartName) => {
    if (!hymnDetail) return;
    const availableSATB = SATB_PARTS.filter((p) => !hymnDetail.tracks[p]);

    let nextParts: PartName[] = [];

    if (clickedPart === 'full') {
      nextParts = ['full'];
    } else {
      if (activeParts.includes('full')) {
        nextParts = [clickedPart];
      } else {
        if (activeParts.includes(clickedPart)) {
          nextParts = activeParts.filter((p) => p !== clickedPart);
          if (nextParts.length === 0) {
            nextParts = hymnDetail.tracks.full ? ['full'] : [clickedPart];
          }
        } else {
          nextParts = [...activeParts, clickedPart];
        }

        const allSelected = availableSATB.length > 0 && availableSATB.every((p) => nextParts.includes(p));
        if (allSelected && hymnDetail.tracks.full) {
          nextParts = ['full'];
        }
      }
    }

    setActiveParts(nextParts);
    audioPlayer.setActiveParts(nextParts);
  };

  const fuse = useMemo(() => {
    return new Fuse(catalog, {
      keys: [
        { name: 'number', weight: 2.0 },
        { name: 'title', weight: 1.5 },
        { name: 'firstLine', weight: 1.0 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    });
  }, [catalog]);

  const filteredHymns = useMemo(() => {
    if (!searchQuery.trim()) return catalog;
    return fuse.search(searchQuery).map((r) => r.item);
  }, [searchQuery, fuse, catalog]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-200">
        <p className="animate-pulse text-lg">Loading hymnal index...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {selectedHymnId && (
            <button
              onClick={() => setSelectedHymnId(null)}
              className="mr-2 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              aria-label="Back to catalog"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <span className="p-2 bg-indigo-600 rounded-lg text-white shadow">
            <Music className="w-5 h-5" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">Hymns For Worship</h1>
        </div>
        <span className="text-xs text-slate-500 font-mono">
          {catalog.length} Hymns Available
        </span>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6">
        {!selectedHymnId ? (
          <div className="space-y-6">
            <div className="relative">
              <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
              <input
                type="search"
                placeholder="Search by number, title, or lyric line..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredHymns.map((hymn) => (
                <button
                  key={hymn.id}
                  onClick={() => setSelectedHymnId(hymn.id)}
                  className="flex flex-col text-left p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-800/60 transition group"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-indigo-400 font-mono">
                      {hymn.number ? `#${hymn.number}` : '—'}
                    </span>
                    {hymn.hasAudio && (
                      <span className="text-slate-500 group-hover:text-indigo-400 transition">
                        <Mic className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                  <h2 className="font-semibold text-slate-100 group-hover:text-white line-clamp-1">
                    {hymn.title}
                  </h2>
                  <p className="text-xs text-slate-400 italic line-clamp-1 mt-1">
                    {hymn.firstLine || '—'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-8 pb-32">
            {hymnDetail ? (
              <div className="space-y-8">
                <div className="border-b border-slate-800 pb-4">
                  <div className="text-sm font-mono text-indigo-400 mb-1">
                    {hymnDetail.number ? `HYMN #${hymnDetail.number}` : 'HYMN'}
                  </div>
                  <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    {hymnDetail.title}
                  </h2>

                  {/* Metadata Chips: Pitch Cue, Beat, Topical Index */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Interactive Pitch Pipe Cue */}
                    {hymnDetail.pitchInfo && (
                      <button
                        onClick={() =>
                          audioPlayer.playPitchCue(
                            hymnDetail.pitchInfo!.note,
                            hymnDetail.pitchInfo!.solfege
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 hover:bg-indigo-900/40 hover:border-indigo-600 text-xs font-mono text-indigo-300 transition shadow-sm group active:scale-95"
                        title={`Play tonic ${hymnDetail.pitchInfo.note}${
                          hymnDetail.pitchInfo.solfege !== 'DO'
                            ? `, step to ${hymnDetail.pitchInfo.solfege}`
                            : ''
                        }`}
                      >
                        <Volume2 className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                        <span className="font-semibold text-white">
                          {hymnDetail.pitchInfo.key || hymnDetail.pitchInfo.note}
                        </span>
                        <span className="text-indigo-300 font-medium">
                          ({hymnDetail.pitchInfo.solfege})
                        </span>
                      </button>
                    )}

                    {/* Conducting Beat / Meter Badge */}
                    {hymnDetail.pitchInfo?.beat && (
                      <div
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400"
                        title="Conducting Beat Pattern"
                      >
                        <span className="text-slate-500 mr-1.5 font-sans uppercase text-[10px] tracking-wider">
                          Beat:
                        </span>
                        <span className="text-slate-200 font-semibold">
                          {hymnDetail.pitchInfo.beat}
                        </span>
                      </div>
                    )}

                    {/* Topical/Print Index Reference */}
                    {hymnDetail.thematicRef && (
                      <div
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400"
                        title="Print Hymnal Thematic Index Category"
                      >
                        <span className="text-slate-500 mr-1.5 font-sans uppercase text-[10px] tracking-wider">
                          Index:
                        </span>
                        <span className="text-slate-300">{hymnDetail.thematicRef}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lyrics Section */}
                <div className="space-y-6 max-w-2xl">
                  {(() => {
                    const verses = hymnDetail.sections.filter((s) => s.type === 'verse');
                    const chorus = hymnDetail.sections.find((s) => s.type === 'chorus');

                    return (
                      <>
                        {verses.length > 0 && (
                          <div className="p-5 rounded-xl border border-slate-800/60 bg-slate-900/40">
                            <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-2">
                              Verse {verses[0].number ?? 1}
                            </div>
                            <div className="space-y-1 text-lg leading-relaxed text-slate-200">
                              {verses[0].lines.map((line, lIdx) => (
                                <p key={lIdx}>{line}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {chorus && (
                          <div className="p-5 rounded-xl border border-indigo-900/50 bg-indigo-950/25 pl-6 border-l-4 border-l-indigo-500 shadow-sm">
                            <div className="text-xs uppercase tracking-wider font-semibold text-indigo-400 mb-2 flex items-center justify-between">
                              <span>Chorus</span>
                              <span className="text-[11px] text-slate-500 lowercase tracking-normal">
                                sung after each verse
                              </span>
                            </div>
                            <div className="space-y-1 text-lg leading-relaxed text-slate-100 font-medium italic">
                              {chorus.lines.map((line, lIdx) => (
                                <p key={lIdx}>{line}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {verses.slice(1).map((verse, idx) => (
                          <div
                            key={verse.number ?? idx + 2}
                            className="p-5 rounded-xl border border-slate-800/60 bg-slate-900/40 space-y-3"
                          >
                            <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">
                              Verse {verse.number ?? idx + 2}
                            </div>
                            <div className="space-y-1 text-lg leading-relaxed text-slate-200">
                              {verse.lines.map((line, lIdx) => (
                                <p key={lIdx}>{line}</p>
                              ))}
                            </div>
                            {chorus && (
                              <div className="pt-2 text-xs text-indigo-400/80 font-mono tracking-wide uppercase">
                                [Chorus]
                              </div>
                            )}
                          </div>
                        ))}

                        {verses.length === 0 &&
                          hymnDetail.sections.map((section, idx) => (
                            <div
                              key={idx}
                              className="p-5 rounded-xl border border-slate-800/60 bg-slate-900/40"
                            >
                              <div className="space-y-1 text-lg leading-relaxed text-slate-200">
                                {section.lines.map((line, lIdx) => (
                                  <p key={lIdx}>{line}</p>
                                ))}
                              </div>
                            </div>
                          ))}
                      </>
                    );
                  })()}
                </div>

                {/* Bottom Audio Player Bar */}
                {Object.keys(hymnDetail.tracks).length > 0 && (
                  <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 backdrop-blur-md p-4 shadow-2xl z-30">
                    <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={handleTogglePlay}
                          disabled={audioLoading}
                          className="p-3 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-lg transition active:scale-95"
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                        >
                          {audioLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="w-5 h-5" />
                          ) : (
                            <Play className="w-5 h-5 ml-0.5" />
                          )}
                        </button>
                        <button
                          onClick={handleStop}
                          disabled={audioLoading}
                          className="p-3 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 transition"
                          aria-label="Stop"
                        >
                          <Square className="w-5 h-5" />
                        </button>
                        <span className="text-xs text-slate-400 font-mono ml-2">
                          {audioLoading
                            ? 'Loading Voice Samples...'
                            : isPlaying
                            ? 'Playing'
                            : 'Ready'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(['full', 'soprano', 'alto', 'tenor', 'bass'] as PartName[]).map((part) => {
                          const hasTrack = hymnDetail.tracks[part];
                          if (!hasTrack) return null;

                          const isActive = activeParts.includes(part);

                          return (
                            <button
                              key={part}
                              onClick={() => handlePartClick(part)}
                              className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold tracking-wide uppercase transition active:scale-95 ${
                                isActive
                                  ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                                  : 'border-slate-800 bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {part}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-400">Loading hymn...</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}