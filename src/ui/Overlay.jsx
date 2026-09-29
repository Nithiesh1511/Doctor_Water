import { BRAND } from '../brand';

function Instagram() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * The scrolling text layer. Rendered inside drei's <Scroll html>.
 * One full-height block per scroll page (see story.js): text sections plus two empty
 * spacers that give the pour and the fill room to play out.
 */
export default function Overlay() {
  return (
    <div className="sections">
      {/* 0 - HERO: the can */}
      <section className="section section--left section--hero">
        <span className="eyebrow">{BRAND.category}</span>
        <h1 className="hero__word hero__word--top">{BRAND.wordmarkTop}</h1>
        <h1 className="hero__word hero__word--bottom">{BRAND.wordmarkBottom}</h1>
        <p className="hero__tagline">{BRAND.tagline}</p>
      </section>

      {/* 1 - UNCAP & POUR */}
      <section className="section section--left">
        <span className="eyebrow">Twist. Pop. Pour.</span>
        <h2 className="section__title">
          Fresh from the <span className="accent">{BRAND.volume} can.</span>
        </h2>
        <p className="section__text">
          Off comes the cap and the purest water you've tasted starts to flow - straight from
          the Doctor's Water can.
        </p>
      </section>

      {/* breathing room: let the pour play out */}
      <section className="section section--spacer" aria-hidden="true" />

      {/* 2 - MACRO: slow-motion droplets */}
      <section className="section section--left section--macro">
        <span className="eyebrow">Slow down. Look closer.</span>
        <h2 className="section__title">
          Every drop, <span className="accent">crystal clear.</span>
        </h2>
        <p className="section__text">
          Nothing floating, nothing hiding - just clean, light, perfectly balanced water.
        </p>
      </section>

      {/* 3 - ZOOM OUT: the bottle rises out of the water */}
      <section className="section section--right">
        <span className="eyebrow">Triple purified</span>
        <h2 className="section__title">
          RO · UV · <span className="accent">Ozonised.</span>
        </h2>
        <p className="section__text">
          Three stages of protection strip away impurities and lock in a crisp, mineral-balanced
          taste - so what reaches your glass is nothing but refreshment.
        </p>
        <div className="pill-row">
          {BRAND.process.map((p) => (
            <span className="pill" key={p}>
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* 4 - FILLING */}
      <section className="section section--right">
        <span className="eyebrow">Filling up</span>
        <h2 className="section__title">
          Drop by drop, <span className="accent">into your bottle.</span>
        </h2>
        <p className="section__text">
          Every refill as crisp and clean as the first - hygienically handled from can to cap.
        </p>
      </section>

      {/* breathing room: the bottle keeps filling */}
      <section className="section section--spacer" aria-hidden="true" />

      {/* 5 - SEALED: the cap goes on as this block arrives */}
      <section className="section section--right">
        <span className="eyebrow">Sealed for freshness</span>
        <h2 className="section__title">
          Capped &amp; <span className="accent">tamper-proof.</span>
        </h2>
        <ul className="note-list">
          {BRAND.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      {/* 6 - SPECS */}
      <section className="section section--right">
        <span className="eyebrow">Certified &amp; trusted</span>
        <h2 className="section__title">
          Quality you can <span className="accent">count on.</span>
        </h2>
        <div className="stats">
          <div className="stat">
            <div className="stat__num">20 L</div>
            <div className="stat__label">Packaged Drinking Water</div>
          </div>
          <div className="stat">
            <div className="stat__num">3-Stage</div>
            <div className="stat__label">RO · UV · Ozonised</div>
          </div>
          <div className="stat">
            <div className="stat__num">ISI · BIS</div>
            <div className="stat__label">Certified Standard</div>
          </div>
          <div className="stat">
            <div className="stat__num">FSSAI</div>
            <div className="stat__label">Approved &amp; Safe</div>
          </div>
        </div>
      </section>

      {/* 7 - CONTACT / FOOTER */}
      <section className="section section--right">
        <span className="eyebrow">Get in touch</span>
        <div className="contact-card">
          <h3>{BRAND.name}</h3>
          <div className="muted">{BRAND.tagline}</div>
          <div className="contact-row">
            <span className="k">Marketed</span>
            <span>{BRAND.company}</span>
          </div>
          <div className="contact-row">
            <span className="k">Address</span>
            <span>{BRAND.address}</span>
          </div>
          <div className="contact-row">
            <span className="k">Phone</span>
            <span>{BRAND.phone}</span>
          </div>
          <div className="contact-row">
            <span className="k">Best before</span>
            <span>{BRAND.bestBefore}</span>
          </div>
          <div className="contact-actions">
            <a className="btn btn--primary" href={BRAND.instagram} target="_blank" rel="noreferrer">
              <Instagram /> Follow on Instagram
            </a>
            <a className="btn btn--ghost" href={BRAND.phoneHref}>
              Call to order
            </a>
          </div>
        </div>
        <div className="footnote">
          © {new Date().getFullYear()} {BRAND.company}. All rights reserved. · For BIS certification
          details visit www.bis.gov.in
        </div>
      </section>
    </div>
  );
}
