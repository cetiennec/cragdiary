// Sits over a demo photo so nobody mistakes it for a real climbing day, or for
// a picture the demo persona took. The images come from Wikimedia Commons and
// carry their author and licence in the caption underneath.
export default function DemoBanner({ label }: { label: string }) {
  return <span className="demo-banner">{label}</span>;
}
