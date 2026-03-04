import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-dvh bg-black px-6 py-8 text-zinc-100">
      <ul className="list-disc pl-5 font-mono text-sm">
        <li>
          <Link
            href="/filmstrip"
            className="underline-offset-4 hover:underline"
          >
            Filmstrip
          </Link>
        </li>
        <li>
          <Link href="/book" className="underline-offset-4 hover:underline">
            Book
          </Link>
        </li>
        <li>
          <Link href="/sketch-wipe" className="underline-offset-4 hover:underline">
            Sketch Wipe
          </Link>
        </li>
        <li>
          <Link href="/sketch" className="underline-offset-4 hover:underline">
            Sketch
          </Link>
        </li>
        <li>
          <Link href="/impact" className="underline-offset-4 hover:underline">
            Impact Frame
          </Link>
        </li>
      </ul>
    </div>
  );
}
