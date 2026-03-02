import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100">
      <h1 className="font-mono text-sm uppercase tracking-widest text-zinc-500">
        Shader Explorations
      </h1>
      <nav className="flex gap-4">
        <Link
          href="/filmstrip"
          className="rounded-lg border border-zinc-800 px-6 py-3 font-mono text-sm transition-colors duration-200 hover:border-zinc-600 hover:bg-zinc-900"
        >
          Filmstrip
        </Link>
        <Link
          href="/book"
          className="rounded-lg border border-zinc-800 px-6 py-3 font-mono text-sm transition-colors duration-200 hover:border-zinc-600 hover:bg-zinc-900"
        >
          Book
        </Link>
      </nav>
    </div>
  );
}
