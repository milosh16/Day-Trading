import Navigation from "@/components/Navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ios-black">
      <main className="pb-24">{children}</main>
      <Navigation />
    </div>
  );
}
