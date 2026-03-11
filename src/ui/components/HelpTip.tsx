import { HelpCircle } from "lucide-react";

interface Props {
  text: string;
}

export default function HelpTip({ text }: Props) {
  return (
    <span className="relative group inline-flex ml-1.5">
      <HelpCircle className="w-3.5 h-3.5 text-neutral-500 hover:text-violet-400 cursor-help transition-colors" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 w-64 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-xl leading-relaxed pointer-events-none">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-700" />
      </span>
    </span>
  );
}
