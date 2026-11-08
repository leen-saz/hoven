// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الطلب حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { addDays, lastDay } from './numbers';
import { useDash } from './useDash';
import { T, pageLang } from './lang';
import { SectionCards } from './SectionCards';
import { OverviewSkeleton } from './Skeletons';
import { DeptsCard, HeatCard, PaceCard, ShareCard, WinsCard } from './AnalyticsCards';
import { OutcomeCards } from './OutcomeCards';
import { longDay } from './format';

<<<<<<< well
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

const RANGES = [['7', '7 أيام', '7 days'], ['30', '30 يوم', '30 days'], ['90', '90 يوم', '90 days']] as const;
=======
// Same choices as the main analytics page: today, yesterday, week, month, the whole history, or any dates
const RANGES = [['t', 'اليوم'], ['y', 'أمس'], ['7', 'أسبوع'], ['30', 'شهر'], ['m', 'هذا الشهر'], ['all', 'كل المدة'], ['c', 'تاريخ مخصص']] as const;
>>>>>>> hoven
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

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data) return <OverviewSkeleton />;
  const to = lastDay(data);
<<<<<<< well
  if (!to) return <p className="ui text-muted-foreground">{T('ما فيه أرقام للحين.', 'No numbers yet.')}</p>;
  const from = addDays(to, -(Number(range) - 1));
=======
  if (!to) return <p className="ui text-muted-foreground">ما فيه أرقام للحين.</p>;
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
        <p className="text-sm text-muted-foreground">{T(`من ${longDay(from)} إلى ${longDay(to)}، مقارنة بنفس المدة اللي قبلها`, `${longDay(from)} to ${longDay(to)}, compared with the same length before`)}</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label={T('الفترة', 'Period')}>
          {RANGES.map(([v, ar, en]) => <ToggleGroupItem key={v} value={v} className="px-4">{T(ar, en)}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <SectionCards data={data} from={from} to={to} />
      <OutcomeCards data={data} from={from} to={to} />
      <React.Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}><TrendChart data={data} from={from} to={to} /></React.Suspense>
=======
        <p className="text-sm text-muted-foreground">من {longDay(from)} إلى {longDay(end)}{range === 'all' ? '' : '، مقارنة بنفس المدة اللي قبلها'}{range === 't' ? ' (اليوم جزئي)' : ''}</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label="الفترة" className="flex-wrap">
          {RANGES.map(([v, t]) => <ToggleGroupItem key={v} value={v} className="px-3">{t}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {range === 'c' && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">من<input type="date" className="rounded-md border px-2 py-1" min={min} max={today} value={custom.from || from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></label>
          <label className="grid gap-1">إلى<input type="date" className="rounded-md border px-2 py-1" min={min} max={today} value={custom.to || end} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}
      <SectionCards data={data} from={from} to={end} />
      <OutcomeCards data={data} from={from} to={end} />
      <TrendChart data={data} from={from} to={end} />
>>>>>>> hoven
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
<<<<<<< well
      <WhenNear minHeight={1040}><AdsTable data={data} from={from} to={to} /></WhenNear>
=======
      <AdsTable data={data} from={from} to={end} />
>>>>>>> hoven
    </div>
    </Direction.Provider>
  );
}
