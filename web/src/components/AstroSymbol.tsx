const paths: Record<string, React.ReactNode> = {
  aries: <><path d="M12 21V9" /><path d="M12 10C12 4 4 3 4 8c0 3 3 4 5 2M12 10c0-6 8-7 8-2 0 3-3 4-5 2" /></>,
  taurus: <><circle cx="12" cy="15" r="5" /><path d="M5 4c0 6 14 6 14 0" /></>,
  gemini: <><path d="M5 4c4 2 10 2 14 0M5 20c4-2 10-2 14 0M8 6v12M16 6v12" /></>,
  cancer: <><circle cx="7" cy="9" r="3" /><circle cx="17" cy="15" r="3" /><path d="M4 6c4-4 12-2 13 3M20 18c-4 4-12 2-13-3" /></>,
  leo: <><circle cx="7" cy="14" r="3" /><path d="M10 14c5 0 1-10 6-10 5 0 3 8 2 11-1 4 2 5 3 2" /></>,
  virgo: <><path d="M4 5v12M4 9c0-5 5-5 5 0v8M9 9c0-5 5-5 5 0v8M14 9c0-5 5-5 5 0v7c0 5-6 6-8 2M14 13c4-1 7 1 5 5" /></>,
  libra: <><path d="M4 19h16M4 14h5M15 14h5M9 14v-2a3 3 0 0 1 6 0v2" /></>,
  scorpio: <><path d="M4 5v12M4 9c0-5 5-5 5 0v8M9 9c0-5 5-5 5 0v8M14 9c0-5 5-5 5 0v10h3M19 16l3 3-3 3" /></>,
  sagittarius: <><path d="M4 20 20 4M8 4h12v12M6 10l8 8" /></>,
  capricorn: <><path d="M4 6c3-4 6 0 6 4v8M10 8c0-6 6-5 6 1v6c0 7-8 7-8 1 0-5 8-5 8 0" /></>,
  aquarius: <><path d="m3 8 4-3 4 3 4-3 4 3 3-2M3 17l4-3 4 3 4-3 4 3 3-2" /></>,
  pisces: <><path d="M7 3c5 5 5 13 0 18M17 3c-5 5-5 13 0 18M4 12h16" /></>,
  sun: <><circle cx="12" cy="12" r="6" /><circle className="astro-symbol__dot" cx="12" cy="12" r="1.2" /></>,
  moon: <path d="M16 3a9 9 0 1 0 5 15A8 8 0 0 1 16 3Z" />,
  mercury: <><path d="M7 2c0 4 10 4 10 0M12 14v8M8 18h8" /><circle cx="12" cy="10" r="4" /></>,
  venus: <><circle cx="12" cy="9" r="5" /><path d="M12 14v8M8 18h8" /></>,
  mars: <><circle cx="9" cy="15" r="5" /><path d="m13 11 7-7M14 4h6v6" /></>,
  jupiter: <><path d="M14 3c-5 0-7 5-3 8 3 2 8-1 8-5M4 14h14M11 5v16" /></>,
  saturn: <><path d="M10 3v18M6 8h9M11 7c6-2 8 3 5 7l-3 4c-2 3 1 5 4 2" /></>,
  uranus: <><circle cx="12" cy="16" r="3" /><path d="M12 13V3M7 4v7M17 4v7M5 8h4M15 8h4" /></>,
  neptune: <><path d="M12 21V3M5 4v5c0 5 14 5 14 0V4M8 18h8" /></>,
  pluto: <><circle cx="12" cy="7" r="3" /><path d="M6 13c0 8 12 8 12 0M12 10v11" /></>,
  true_node: <><path d="M8 17a4 4 0 0 1 8 0M8 17V7M16 17V7M6 7h12" /></>,
  mean_node: <><path d="M8 17a4 4 0 0 1 8 0M8 17V7M16 17V7M6 7h12" /></>,
  south_node: <><path d="M8 7a4 4 0 0 0 8 0M8 7v10M16 7v10M6 17h12" /></>,
  chiron: <><circle cx="12" cy="16" r="4" /><path d="M12 12V3M8 6h8M9 3l6 6" /></>,
  lilith: <><path d="M14 3a7 7 0 1 0 5 11 6 6 0 0 1-5-11ZM12 15v7M8 19h8" /></>,
  fortune: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></>,
  vertex: <><circle cx="12" cy="12" r="7" /><path d="m8 8 8 8M16 8l-8 8" /></>,
  fallback: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle className="astro-symbol__dot" cx="12" cy="12" r="1.2" /></>,
};

const aliases: Record<string, string> = {
  'outer:true_node': 'true_node', 'outer:mean_node': 'mean_node',
  black_moon_lilith: 'lilith', mean_lilith: 'lilith', part_of_fortune: 'fortune',
  northnode: 'true_node', north_node: 'true_node', truenode: 'true_node', meannode: 'mean_node', southnode: 'south_node',
};

export function AstroSymbol({ id, className = '', x, y, size }: { id: string; className?: string; x?: number; y?: number; size?: number }) {
  const normalized = id.replace(/^outer:/, '').toLowerCase();
  const key = aliases[id] || aliases[normalized] || normalized;
  return <svg className={`astro-symbol ${className}`} x={x} y={y} width={size ?? 18} height={size ?? 18} style={{ width: size ?? 18, height: size ?? 18 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[key] || paths.fallback}</svg>;
}
