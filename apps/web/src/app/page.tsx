export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div>
            <p className="text-sm font-medium text-cyan-300">Risk on Radar</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Reliability intelligence workspace
            </h1>
          </div>
          <a
            className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200"
            href="https://riskonradar.com/"
          >
            Landing site
          </a>
        </header>

        <div className="grid flex-1 gap-4 py-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Evidence-backed FMEA</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  The first product loop will search failure evidence by
                  component, system, or operating context, then help engineers
                  review citations and create traceable FMEA rows.
                </p>
              </div>
              <span className="rounded-md bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200">
                Scaffold
              </span>
            </div>

            <div className="mt-8 grid gap-3">
              {[
                "Search candidate failure evidence",
                "Review ranked failure modes with citations",
                "Accept, edit, reject, or annotate suggestions",
                "Promote reviewed suggestions into FMEA rows",
              ].map((item, index) => (
                <div
                  className="flex items-center gap-3 rounded-md border border-white/10 bg-slate-900/80 p-4"
                  key={item}
                >
                  <span className="flex size-7 items-center justify-center rounded-md bg-slate-800 text-sm font-semibold text-cyan-200">
                    {index + 1}
                  </span>
                  <span className="text-sm text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="grid gap-4">
            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-base font-semibold">Paper discovery</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Lightweight service for continuously finding raw candidate
                papers from journal and publisher sources.
              </p>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-base font-semibold">Paper classifier</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Separate service for title/abstract classification and
                structured reliability knowledge extraction.
              </p>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-base font-semibold">Database direction</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                SQLite is acceptable for the prototype, but the model should be
                designed for a later Postgres move.
              </p>
            </section>
          </aside>
        </div>

        <footer className="border-t border-white/10 pt-5 text-sm text-slate-400">
          App scaffold for the Risk on Radar product repository.
        </footer>
      </section>
    </main>
  );
}
