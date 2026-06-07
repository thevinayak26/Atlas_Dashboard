// ─────────────────────────────────────────────────────────────────────────────
// GlowCard.jsx — the dashboard card shell. Wraps BorderGlow with the ATLAS glass
// look (translucent panel + backdrop blur, applied in theme.css via
// .border-glow-card.glow-card) and a restrained, theme-aware palette so the
// cursor-following border glow reads as "ours", not the stock neon.
//   • outer element carries the grid-area id (#c-map …) + glass styling
//   • children render inside .border-glow-inner (clipped, flex column)
// ─────────────────────────────────────────────────────────────────────────────
import BorderGlow from './BorderGlow';

// Only the edge glow is used (the interior mesh is disabled in theme.css), so
// glowColor is what matters. Dark mode keeps a warm champagne/amber rim that
// reads as premium against the near-black panel. Light mode matches the teal
// ATLAS accent (--accent #0d9488 ≈ "175 84 32"): darker and cohesive against the
// cream background — the old warm amber washed out / read as yellow on light.
// Expressed as "H S L".
const PALETTE = {
  dark: { glow: '40 60 66' },
  light: { glow: '175 84 32' },
};

export default function GlowCard({ id, theme = 'dark', className = '', children }) {
  const p = PALETTE[theme] || PALETTE.dark;
  return (
    <BorderGlow
      id={id}
      className={`glow-card ${className}`}
      backgroundColor="var(--panel)"
      borderRadius={16}
      glowColor={p.glow}
      glowIntensity={0.95}
      glowRadius={30}
      coneSpread={32}
      edgeSensitivity={26}
      fillOpacity={0}
    >
      {children}
    </BorderGlow>
  );
}
