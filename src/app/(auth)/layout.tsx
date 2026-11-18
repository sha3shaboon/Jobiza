import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8"><Logo layout="stacked" className="text-5xl" /></div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
