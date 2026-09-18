/**
 * THE SLOT THAT STAYS EMPTY UNTIL THERE IS SOMETHING TRUE TO PUT IN IT.
 *
 * It renders NOTHING while the array is empty — no greyed-out "your logo
 * here", no placeholder brands, no invented names. Those are the two ways this
 * usually goes wrong: a row of fake customers, or a visibly empty row that
 * tells a visitor the company has none.
 *
 * The component exists so that filling it later is one line at the call site
 * rather than a layout decision made under pressure.
 */
export function CustomerLogos({ customers }: { customers: Array<{ name: string; src: string }> }) {
  if (customers.length === 0) return null;

  return (
    <div className="customer-row">
      <p className="t-label">Trusted by</p>
      <ul className="customer-list">
        {customers.map((c) => (
          <li key={c.name}>
            {/* Explicit dimensions, because a logo row above the fold with
                unsized images is a guaranteed layout shift. */}
            <img src={c.src} alt={c.name} height={28} width={112} loading="lazy" decoding="async" />
          </li>
        ))}
      </ul>
    </div>
  );
}
