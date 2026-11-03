/** Emblem: a rising sun behind a seated meditating figure framed by two leaves. */
export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Pahil Vatika Yoga Group">
      <circle cx="32" cy="32" r="31" fill={light ? "#F7F4EA" : "#183D32"} />
      <circle cx="32" cy="30" r="12" fill="#E6B85C" />
      {[...Array(9)].map((_, i) => {
        const a = Math.PI + (i * Math.PI) / 8;
        return (
          <line key={i} x1={32 + Math.cos(a) * 15} y1={30 + Math.sin(a) * 15} x2={32 + Math.cos(a) * 19} y2={30 + Math.sin(a) * 19}
            stroke="#E6B85C" strokeWidth="2" strokeLinecap="round" />
        );
      })}
      <path d="M9 44 C18 36 26 38 32 46 C38 38 46 36 55 44 C46 50 38 50 32 46 C26 50 18 50 9 44Z" fill="#4C956C" />
      <circle cx="32" cy="27.5" r="3" fill={light ? "#183D32" : "#F7F4EA"} />
      <path d="M32 31 C29 31 28 34 28.5 37 L24 40 C23 40.6 23.6 42 24.6 41.6 L32 39.4 L39.4 41.6 C40.4 42 41 40.6 40 40 L35.5 37 C36 34 35 31 32 31Z"
        fill={light ? "#183D32" : "#F7F4EA"} />
    </svg>
  );
}
