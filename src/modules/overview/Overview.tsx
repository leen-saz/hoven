// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الطلب حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { addDays, lastDay } from './numbers';
import { useDash } from './useDash';
import { SectionCards } from './SectionCards';
import { TrendChart } from './TrendChart';
import { AdsTable } from './AdsTable';
import { DeptsCard, HeatCard, PaceCard, ShareCard, WinsCard } from './AnalyticsCards';
import { OutcomeCards } from './OutcomeCards';
import { longDay } from './format';

// Same choices as the main analytics page: today, yesterday, week, month, the whole history, or any dates
const RANGES = [['t', 'اليوم'], ['y', 'أمس'], ['7', 'أسبوع'], ['30', 'شهر'], ['m', 'هذا الشهر'], ['all', 'كل المدة'], ['c', 'تاريخ مخصص']] as const;
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
  if (!data) {
    return (
      <div className="ui grid gap-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  const to = lastDay(data);
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

  return (
    // Radix menus, selects and the sheet open in their own layer: tell them the page is Arabic
    <Direction.Provider dir="rtl">
    <div className="ui grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
      <AdsTable data={data} from={from} to={end} />
    </div>
    </Direction.Provider>
  );
}
