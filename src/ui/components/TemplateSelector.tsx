import { useTemplates } from "../hooks/useProject";
import { FileCode, Globe, Server, Terminal, Puzzle } from "lucide-react";

const icons: Record<string, React.ElementType> = {
  fullstack: Globe,
  "api-backend": Server,
  "landing-page": FileCode,
  "cli-tool": Terminal,
  custom: Puzzle,
};

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function TemplateSelector({ value, onChange }: Props) {
  const { data: templates } = useTemplates();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {(templates ?? []).map((t) => {
        const Icon = icons[t.name] ?? Puzzle;
        const active = value === t.name;
        return (
          <button
            key={t.name}
            type="button"
            onClick={() => onChange(t.name)}
            className={`p-3 rounded-lg border text-left text-sm transition-colors ${
              active
                ? "border-violet-500 bg-violet-600/10 text-violet-300"
                : "border-neutral-700 hover:border-neutral-600 text-neutral-400"
            }`}
          >
            <Icon className="w-5 h-5 mb-1" />
            <div className="font-medium capitalize">
              {t.name.replace("-", " ")}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {t.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
