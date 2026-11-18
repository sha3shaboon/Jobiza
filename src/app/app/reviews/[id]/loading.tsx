export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" aria-label="Loading…">
      <div className="h-9 w-48 animate-pulse rounded-[10px] bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-4 h-5 w-80 max-w-full animate-pulse rounded-[8px] bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-10 grid gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-[12px] bg-surface-2 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
