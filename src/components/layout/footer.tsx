import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const groups = [
  { title: "Product", links: [["Monitoring", "/monitoring"], ["Findings", "/product#findings"], ["Web design", "/custom-compliance"], ["Audit Trail", "/product#audit-trail"]] },
  { title: "Company", links: [["About", "/about"], ["Contact", "/contact"]] },
  { title: "Legal", links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["Refund & Cancellation", "/refund"]] },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-white/[.09] bg-[#060606]">
      <div className="container-shell py-14 sm:py-20">
        <div className="grid gap-12 md:grid-cols-[1.35fr_2fr]">
          <div>
            <Logo />
            <p className="mt-5 max-w-xs text-sm leading-6 text-[#89857f]">Continuous merchant compliance and risk intelligence for modern commerce.</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-semibold uppercase text-[#66635d]">{group.title}</p>
                <ul className="mt-5 space-y-3">
                  {group.links.map(([label, href]) => <li key={href}><Link className="text-sm text-[#aaa69f] transition-colors hover:text-white" href={href}>{label}</Link></li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 border-t border-white/[.08] pt-7">
          <p className="max-w-4xl text-xs leading-5 text-[#666a73]">ORBIT provides B2B software for compliance monitoring and risk intelligence. ORBIT is not a legal advisor and does not make legal determinations or guarantee compliance outcomes.</p>
          <div className="mt-5 flex flex-col gap-2 text-xs text-[#5e626b] sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} ORBIT. All rights reserved.</span>
            <span>Independent B2B software platform.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
