import type { LucideIcon } from "lucide-react";

export function FeatureList({ items }: { items: Array<{ title: string; description: string; icon: LucideIcon }> }) {
  return (
    <div className="border-t border-white/[.08]">
      {items.map(({title,description,icon:Icon}, index) => <div key={title} className="grid gap-4 border-b border-white/[.08] py-7 sm:grid-cols-[54px_1fr_1.4fr] sm:items-start"><span className="font-mono text-[9px] text-[#5d5f78]">0{index+1}</span><div className="flex items-center gap-3"><Icon className="size-4 text-[#a78bfa]"/><h3 className="text-sm font-medium text-[#d9d9e8]">{title}</h3></div><p className="text-sm leading-6 text-[#87899f]">{description}</p></div>)}
    </div>
  );
}
