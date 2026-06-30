export function EmptyState({ icon: Icon, title, description }) {
  return (
    <section className="flex min-h-[520px] items-center justify-center rounded-lg border border-slate-800 bg-[#090b10] p-8 text-center shadow-xl shadow-black/20">
      <div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
          <Icon className="h-6 w-6 text-[var(--market-accent)]" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
    </section>
  )
}
