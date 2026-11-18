import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="on-field grain relative hidden flex-col justify-between gap-8 overflow-hidden p-10 md:flex">
        <Logo layout="stacked" className="self-start text-5xl" />
        <p className="max-w-sm text-xl leading-relaxed">Every answer cites the page it came from, so you can always check.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration with filters */}
        <img src="/illustrations/research-shelf.svg" alt="" width={1000} height={560} className="block h-auto w-full" />
      </aside>
      <main id="main" className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <div className="mb-10 md:hidden">
          <Logo layout="stacked" className="text-4xl" />
        </div>
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}
