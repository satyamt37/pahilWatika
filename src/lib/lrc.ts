/** Parse LRC ("[01:23.45] line") into sorted {t, text} pairs. */
export function parseLrc(lrc: string | null | undefined): { t: number; text: string }[] {
  if (!lrc) return [];
  const out: { t: number; text: string }[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) out.push({ t: +s[1] * 60 + +s[2] + (s[3] ? +`0.${s[3]}` : 0), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Index of the lyric line being sung at time `t` (seconds), or -1 before the first line. */
export function activeLine(lines: { t: number }[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length && lines[i].t <= t; i++) idx = i;
  return idx;
}
