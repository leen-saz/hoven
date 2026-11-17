// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الطلب حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { lastDay } from './numbers';
import { PeriodFilter, type Period } from './PeriodFilter';
import { useDash } from './useDash';
import { T, pageLang } from './lang';
import { SectionCards } from './SectionCards';
import { OverviewSkeleton } from './Skeletons';
import { DeptsCard, HeatCard, PaceCard, ShareCard, WinsCard } from './AnalyticsCards';
import { OutcomeCards } from './OutcomeCards';
import { longDay } from './format';

// The chart (Recharts) and the ads table (TanStack Table, menus, the sheet) are separate files: the numbers above them
// draw first. The chart starts loading at once; the table only when it is about to scroll into view.
const TrendChart = React.lazy(() => import('./TrendChart').then(m => ({ default: m.TrendChart })));
const AdsTable = React.lazy(() => import('./AdsTable').then(m => ({ default: m.AdsTable })));

// Renders its children once the placeholder comes within a screen of the viewport
function WhenNear({ minHeight, children }: { minHeight: number; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const box = <Skeleton className="rounded-xl" style={{ minHeight }} />;
  return near ? <React.Suspense fallback={box}>{children}</React.Suspense> : <div ref={ref}>{box}</div>;
}

<<<<<<< well
export default function Overview() {
  const { data, error } = useDash();
  const [period, setPeriod] = React.useState<Period | null>(null);
=======
// Same choices as the main analytics page: today, yesterday, week, month, the whole history, or any dates
const RANGES = [['t', 'اليوم', 'Today'], ['y', 'أمس', 'Yesterday'], ['7', 'أسبوع', 'Week'], ['30', 'شهر', 'Month'], ['m', 'هذا الشهر', 'This month'], ['all', 'كل المدة', 'All time'], ['c', 'تاريخ مخصص', 'Custom dates']] as const;
type Range = (typeof RANGES)[number][0];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function firstDay(d: { range?: { start?: string }; rows?: unknown[][] }): string | null {
  if (d.range?.start && DAY.test(d.range.start)) return d.range.start;
  let min: string | null = null;
  for (const r of d.rows ?? []) { const day = String(r[1] ?? ''); if (DAY.test(day) && (!min || day < min)) min = day; }
  return min;
}

export default function Overview() {
  const { data, error } = useDash();
  const [range, setRange] = React.useState<Range>('30');
  const [custom, setCustom] = React.useState<{ from: string; to: string }>({ from: '', to: '' });
>>>>>>> hoven

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data) return <OverviewSkeleton />;
  const to = lastDay(data);
  if (!to) return <p className="ui text-muted-foreground">{T('ما فيه أرقام للحين.', 'No numbers yet.')}</p>;
<<<<<<< well
  // Days are the data's own (Riyadh) days: today, the last full day (range.end) and the first day the data has
  const ctx = { today: data.range?.today || to, last: to, min: data.range?.start || to };
  const from = period?.from ?? to;
  const end = period?.to ?? to;
=======
  const min = firstDay(data) || to;
  const today = (data.range?.today && DAY.test(data.range.today)) ? data.range.today : to;
  const clamp = (x: string) => (x < min ? min : x > today ? today : x);
  let from: string, end: string = to;
  if (range === 't') { from = today; end = today; }
  else if (range === 'y') { from = clamp(addDays(today, -1)); end = from; }
  else if (range === 'm') { from = clamp(to.slice(0, 8) + '01'); }
  else if (range === 'all') { from = min; }
  else if (range === 'c') {
    const a = DAY.test(custom.from) ? clamp(custom.from) : addDays(to, -29), b = DAY.test(custom.to) ? clamp(custom.to) : to;
    [from, end] = a <= b ? [a, b] : [b, a];
  } else from = clamp(addDays(to, -(Number(range) - 1)));
>>>>>>> hoven

  return (
    // Radix menus, selects and the sheet open in their own layer: tell them the page direction (Arabic RTL, English LTR)
    <Direction.Provider dir={pageLang() === 'en' ? 'ltr' : 'rtl'}>
    {/* min-w-0: a wide table or chart scrolls inside its card instead of widening the page on a phone */}
    <div className="ui grid gap-4 [&>*]:min-w-0 [&>.grid>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
<<<<<<< well
        <p className="text-sm text-muted-foreground">{period ? T(`من ${longDay(from)} إلى ${longDay(end)}، مقارنة بنفس المدة اللي قبلها`, `${longDay(from)} to ${longDay(end)}, compared with the same length before`) : ''}</p>
        <PeriodFilter id="overview" def="30" ctx={ctx} onChange={setPeriod} />
      </div>
      {/* The full dashboard (campaigns, platforms, organic) lives on «/»: it is not in the menu when this page is on, so it is linked here */}
      <p className="text-sm"><a className="underline underline-offset-4" href="/">{T('افتح اللوحة الكاملة (الحملات والمنصات والعضوي) ←', 'Open the full dashboard (campaigns, platforms, organic) →')}</a></p>
      {period && <>
=======
        <p className="text-sm text-muted-foreground">{T(`من ${longDay(from)} إلى ${longDay(end)}`, `${longDay(from)} to ${longDay(end)}`)}{range === 'all' ? '' : T('، مقارنة بنفس المدة اللي قبلها', ', compared with the same length before')}{range === 't' ? T(' (اليوم جزئي)', ' (today is partial)') : ''}</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label={T('الفترة', 'Period')} className="flex-wrap">
          {RANGES.map(([v, ar, en]) => <ToggleGroupItem key={v} value={v} className="px-3">{T(ar, en)}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {range === 'c' && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">{T('من', 'From')}<input type="date" className="rounded-md border px-2 py-1" min={min} max={today} value={custom.from || from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></label>
          <label className="grid gap-1">{T('إلى', 'To')}<input type="date" className="rounded-md border px-2 py-1" min={min} max={today} value={custom.to || end} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}
>>>>>>> hoven
      <SectionCards data={data} from={from} to={end} />
      <OutcomeCards data={data} from={from} to={end} />
      <React.Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}><TrendChart data={data} from={from} to={end} /></React.Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <ShareCard data={data} from={from} to={end} />
        <PaceCard data={data} from={from} to={end} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WinsCard data={data} from={from} to={end} />
        <DeptsCard data={data} from={from} to={end} />
      </div>
      <div className="grid gap-4">
        <HeatCard data={data} from={from} to={end} />
      </div>
      <WhenNear minHeight={1040}><AdsTable data={data} from={from} to={end} /></WhenNear>
<<<<<<< well
      </>}
=======
>>>>>>> hoven
    </div>
    </Direction.Provider>
  );
}
