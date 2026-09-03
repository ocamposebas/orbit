export default function CustomerDetailLoading() {
  return <div className="mx-auto w-full max-w-[1320px] animate-pulse px-4 py-7 sm:px-7 lg:px-10 lg:py-10"><div className="h-3 w-28 rounded bg-white/[.06]" /><div className="mt-6 h-52 rounded-[26px] border border-white/[.05] bg-white/[.025]" /><div className="mt-5 grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 rounded-[20px] bg-white/[.025]" />)}</div><div className="mt-5 h-96 rounded-[24px] bg-white/[.025]" /></div>;
}
