export default function ProfileCover({
  username,
  hasCover,
}: {
  username: string;
  hasCover: boolean;
}) {
  if (hasCover) {
    return (
      <div className="profile-cover">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized server-side */}
        <img src={`/api/covers/${username}`} alt="" />
      </div>
    );
  }

  // Default cover: hand-drawn line mountains in the theme's palette.
  return (
    <div className="profile-cover profile-cover-default" aria-hidden>
      <svg viewBox="0 0 1400 320" preserveAspectRatio="xMidYMax slice" fill="none">
        <circle cx="1150" cy="88" r="44" stroke="currentColor" strokeWidth="3" opacity="0.5" />
        <path
          d="M-20 290 L170 130 L260 210 L390 60 L470 150 L520 110 L640 240"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M540 290 L720 100 L810 190 L940 40 L1060 180 L1140 120 L1420 290"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M330 290 L480 190 L560 250 L680 170 L790 260 L900 200 L1050 290"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.35"
        />
        <path d="M382 70 L390 60 L399 71" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <path d="M931 51 L940 40 L950 52" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      </svg>
    </div>
  );
}
