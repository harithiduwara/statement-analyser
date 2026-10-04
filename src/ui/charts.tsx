import { useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { formatMoney } from '@/lib/money';
import { formatMonthKey } from '@/lib/dates';

/**
 * Chart kit.
 *
 * House rules, applied to every chart here:
 *  - every axis is titled and every chart states its unit; no bare numbers
 *  - two measures of different scale get two charts, never two y-scales
 *  - a legend whenever there is more than one series, plus direct labels
 *  - series colours come from a palette validated for colourblind separation
 *    and contrast in both themes; colour never carries identity alone
 *  - hover is default, not an enhancement
 *
 * Colours are referenced as CSS custom properties so a theme change repaints
 * without React re-rendering, and so the dark steps are the ones selected for
 * the dark surface rather than an automatic flip of the light ones.
 */

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;

const AXIS_TICK = { fontSize: 10.5, fill: 'var(--ink-muted)' };
const AXIS_LABEL = {
  fontSize: 10.5,
  fill: 'var(--ink-muted)',
  letterSpacing: '0.06em',
} as const;

/** Compact LKR for axis ticks: 1_250_000 -> 1.25M */
export function compactLkr(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 0)}k`;
  return String(Math.round(value));
}

export function ChartFrame({
  title,
  unit,
  note,
  height = 260,
  children,
  aside,
}: {
  title: string;
  unit: string;
  note?: ReactNode;
  height?: number;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <figure className="panel m-0 px-4 py-3">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[12.5px] font-semibold tracking-tight">{title}</h3>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {unit}
            {note ? <> · {note}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aside}
          <ChartExport getSvg={() => bodyRef.current?.querySelector('svg') ?? null} title={title} />
        </div>
      </figcaption>
      <div ref={bodyRef} style={{ height }}>
        {children}
      </div>
    </figure>
  );
}

/**
 * Per-chart export. The chart is already an on-screen SVG, so this grabs it and
 * hands it to the dependency-free rasteriser -- loaded only on first use. A
 * backdrop closes the little menu on an outside click.
 */
function ChartExport({ getSvg, title }: { getSvg: () => SVGSVGElement | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (kind: 'pdf' | 'png'): Promise<void> => {
    const svg = getSvg();
    setOpen(false);
    if (!svg) return;
    setBusy(true);
    try {
      const chartImage = await import('@/export/chartImage');
      const base = slugify(title);
      if (kind === 'pdf') await chartImage.exportChartPdf(svg, { title, filename: `${base}.pdf` });
      else await chartImage.exportChartPng(svg, `${base}.png`);
    } catch {
      // Nothing is sent or stored, so a failed export leaves no trace to undo.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export this chart"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-[background-color,border-color] duration-150 ease-out hover:bg-[var(--surface-sunken)]"
        style={{ color: 'var(--ink-secondary)', border: '1px solid var(--line-strong)' }}
      >
        <Download size={12} aria-hidden />
        {busy ? 'Exporting…' : 'Export'}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[132px] overflow-hidden rounded-md py-1 text-[11.5px]"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <ChartExportItem onClick={() => void run('pdf')}>PDF document</ChartExportItem>
            <ChartExportItem onClick={() => void run('png')}>PNG image</ChartExportItem>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ChartExportItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
      style={{ color: 'var(--ink)' }}
    >
      {children}
    </button>
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'chart'
  );
}

function TooltipBox({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: number; color?: string }[];
}) {
  return (
    <div
      className="rounded-md px-2.5 py-2 text-[11.5px] shadow-lg"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-strong)',
        color: 'var(--ink)',
      }}
    >
      <div className="mb-1 font-semibold">{label}</div>
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2 whitespace-nowrap">
          {row.color ? (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: row.color }}
            />
          ) : null}
          <span style={{ color: 'var(--ink-secondary)' }}>{row.name}</span>
          <span className="num ml-auto font-medium">{formatMoney(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function makeTooltip(labelOf: (label: string) => string) {
  return function RenderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    return (
      <TooltipBox
        label={labelOf(String(props.label ?? ''))}
        rows={props.payload.map((entry) => ({
          name: String(entry.name ?? entry.dataKey ?? ''),
          value: Number(entry.value ?? 0),
          ...(entry.color ? { color: entry.color } : {}),
        }))}
      />
    );
  };
}

const legendStyle = { fontSize: 11, color: 'var(--ink-secondary)', paddingBottom: 8 } as const;

/**
 * Charts here do not animate.
 *
 * A dense analytical view is read, not watched: a grow-in obscures the values
 * for the first second, and a reader comparing two panels sees them at
 * different points in their animations. It also makes the rendered output
 * non-deterministic, which is exactly what a visual check needs it not to be.
 */
const STATIC_MARK = { isAnimationActive: false } as const;

// --- charge decomposition ---------------------------------------------------

export interface DecompositionDatum {
  label: string;
  instalments: number;
  everyday: number;
  feesAndInterest: number;
}

/**
 * Stacked bars, one per cycle. A 2px surface-coloured gap separates the
 * segments so adjacent fills never touch, and the legend plus the cycle table
 * below carry identity for the light-mode aqua, which sits under 3:1 on the
 * light surface by design.
 */
export function DecompositionChart({ data }: { data: DecompositionDatum[] }) {
  return (
    <ChartFrame
      title="What each cycle was made of"
      unit="LKR per cycle, reversals removed"
      note="instalments and their fees, everyday spending, and the cost of holding the card"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 24, left: 56 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            label={{ value: 'CYCLE', position: 'insideBottom', offset: -16, style: AXIS_LABEL }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactLkr}
            label={{
              value: 'LKR',
              angle: -90,
              position: 'insideLeft',
              offset: -8,
              style: AXIS_LABEL,
            }}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-sunken)' }}
            content={makeTooltip((l) => `Cycle ${l}`)}
          />
          <Legend
            wrapperStyle={legendStyle}
            iconType="square"
            iconSize={9}
            verticalAlign="top"
            align="left"
          />
          {/* A 2px surface-coloured stroke keeps adjacent fills from touching. */}
          <Bar {...STATIC_MARK} dataKey="instalments" name="Instalments" stackId="a" maxBarSize={72} fill={SERIES[0]} stroke="var(--surface)" strokeWidth={2} />
          <Bar {...STATIC_MARK} dataKey="everyday" name="Everyday" stackId="a" maxBarSize={72} fill={SERIES[1]} stroke="var(--surface)" strokeWidth={2} />
          <Bar
            {...STATIC_MARK}
            dataKey="feesAndInterest"
            name="Fees & interest"
            stackId="a"
            maxBarSize={72}
            fill={SERIES[2]}
            stroke="var(--surface)"
            strokeWidth={2}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// --- forward schedule -------------------------------------------------------

export interface ForwardDatum {
  month: string;
  total: number;
  cumulative: number;
}

/**
 * The obligation curve. Deliberately a step (`type="stepAfter"`): the amount
 * due is constant through a month and drops the moment a plan retires, and a
 * smoothed line would draw a gradual decline that never happens.
 */
export function ForwardCurveChart({
  data,
  markers,
}: {
  data: ForwardDatum[];
  markers?: { month: string; label: string }[];
}) {
  return (
    <ChartFrame
      title="Monthly instalment obligation"
      unit="LKR due per month"
      note="each step down is a plan making its final payment"
      height={260}
      aside={
        markers && markers.length > 0 ? (
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {markers.length} plan{markers.length === 1 ? '' : 's'} retiring in view
          </span>
        ) : null
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 28, left: 56 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="month"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            tickFormatter={formatMonthKey}
            minTickGap={28}
            label={{ value: 'MONTH', position: 'insideBottom', offset: -16, style: AXIS_LABEL }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactLkr}
            // Headroom, so a flat series does not run along the frame's edge
            // and read as clipped.
            domain={[0, (max: number) => Math.ceil(max * 1.12)]}
            label={{ value: 'LKR', angle: -90, position: 'insideLeft', offset: -8, style: AXIS_LABEL }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
            content={makeTooltip((l) => formatMonthKey(l))}
          />
          <Line
            {...STATIC_MARK}
            type="stepAfter"
            dataKey="total"
            name="Due that month"
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Cumulative outflow. A separate chart rather than a second y-axis on the one
 * above: the two measures differ by an order of magnitude, and a dual-axis
 * chart lets the reader infer a crossing point that has no meaning.
 */
export function CumulativeOutflowChart({ data }: { data: ForwardDatum[] }) {
  return (
    <ChartFrame
      title="Cumulative outflow"
      unit="LKR paid, running total from next month"
      height={220}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 28, left: 56 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="month"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            tickFormatter={formatMonthKey}
            minTickGap={28}
            label={{ value: 'MONTH', position: 'insideBottom', offset: -16, style: AXIS_LABEL }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactLkr}
            // Headroom, so a flat series does not run along the frame's edge
            // and read as clipped.
            domain={[0, (max: number) => Math.ceil(max * 1.12)]}
            label={{ value: 'LKR', angle: -90, position: 'insideLeft', offset: -8, style: AXIS_LABEL }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
            content={makeTooltip((l) => formatMonthKey(l))}
          />
          <Line
            {...STATIC_MARK}
            type="monotone"
            dataKey="cumulative"
            name="Paid by then"
            stroke={SERIES[1]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// --- horizontal magnitude bars ---------------------------------------------

export interface RankedDatum {
  label: string;
  value: number;
  /** Marks a row that needs to stand out -- a non-zero cost of credit. */
  highlight?: boolean;
}

/**
 * Ranked horizontal bars for a single measure. One series, so no legend: the
 * title names what is plotted, and each bar is directly labelled.
 */
export function RankedBarChart({
  data,
  title,
  unit,
  note,
  height,
  highlightNote,
}: {
  data: RankedDatum[];
  title: string;
  unit: string;
  note?: string;
  height?: number;
  highlightNote?: string;
}) {
  const computed = height ?? Math.max(180, data.length * 26 + 60);
  return (
    <ChartFrame
      title={title}
      unit={unit}
      {...(note === undefined ? {} : { note })}
      height={computed}
      aside={
        highlightNote ? (
          <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: SERIES[1] }} />
            {highlightNote}
          </span>
        ) : null
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 76, bottom: 26, left: 8 }}
          barCategoryGap="24%"
        >
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            tickFormatter={compactLkr}
            label={{ value: 'LKR', position: 'insideBottom', offset: -14, style: AXIS_LABEL }}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...AXIS_TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={170}
          />
          <Tooltip cursor={{ fill: 'var(--surface-sunken)' }} content={makeTooltip((l) => l)} />
          <Bar {...STATIC_MARK} dataKey="value" name={unit} maxBarSize={22} radius={[0, 3, 3, 0]} label={<ValueLabel />}>
            {data.map((row) => (
              <Cell key={row.label} fill={row.highlight ? SERIES[1] : SERIES[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Direct value labels; identity never rests on the fill colour alone. */
function ValueLabel(props: { x?: number; y?: number; width?: number; height?: number; value?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, value = 0 } = props;
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      dominantBaseline="middle"
      style={{ fontSize: 10.5, fill: 'var(--ink-secondary)', fontVariantNumeric: 'tabular-nums' }}
    >
      {formatMoney(value)}
    </text>
  );
}

// --- monthly plan donut -----------------------------------------------------

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

/**
 * A part-to-whole ring for the monthly plan. Identity is not left to colour:
 * the panel renders a labelled legend beside it, and hover names each slice.
 */
export function DonutChart({
  title,
  unit,
  data,
  centerValue,
  note,
}: {
  title: string;
  unit: string;
  data: DonutDatum[];
  centerValue: string;
  note?: ReactNode;
}) {
  return (
    <ChartFrame title={title} unit={unit} {...(note === undefined ? {} : { note })} height={220}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="var(--surface)"
            strokeWidth={2}
            {...STATIC_MARK}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
            <Label
              value={centerValue}
              position="center"
              style={{ fontSize: 19, fontWeight: 600, fill: 'var(--ink)' }}
            />
          </Pie>
          <Tooltip content={renderDonutTooltip} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function renderDonutTooltip(props: TooltipContentProps) {
  if (!props.active || !props.payload?.length) return null;
  const entry = props.payload[0]!;
  const color = (entry.payload as { color?: string } | undefined)?.color;
  return (
    <TooltipBox
      label={String(entry.name ?? '')}
      rows={[{ name: 'per month', value: Number(entry.value ?? 0), ...(color ? { color } : {}) }]}
    />
  );
}

// --- money in and out, by month --------------------------------------------

export interface FlowDatum {
  label: string;
  moneyIn: number;
  moneyOut: number;
}

/**
 * Grouped bars, one pair per month: what was paid in and what was spent out.
 * Two measures of the same unit and scale, so one chart with two series is
 * right; the legend and hover carry which is which.
 */
export function MonthlyFlowChart({ data }: { data: FlowDatum[] }) {
  return (
    <ChartFrame
      title="Money in and out, by month"
      unit="LKR per month"
      note="in = payments that settle the account · out = spending, reversals removed"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 24, left: 56 }} barCategoryGap="22%" barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            label={{ value: 'MONTH', position: 'insideBottom', offset: -16, style: AXIS_LABEL }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactLkr}
            label={{ value: 'LKR', angle: -90, position: 'insideLeft', offset: -8, style: AXIS_LABEL }}
          />
          <Tooltip cursor={{ fill: 'var(--surface-sunken)' }} content={makeTooltip((l) => l)} />
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} verticalAlign="top" align="left" />
          <Bar {...STATIC_MARK} dataKey="moneyIn" name="In (paid)" maxBarSize={46} fill={SERIES[2]} radius={[3, 3, 0, 0]} />
          <Bar {...STATIC_MARK} dataKey="moneyOut" name="Out (spent)" maxBarSize={46} fill={SERIES[1]} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// --- a monthly value over time ----------------------------------------------

export interface TrendDatum {
  month: string;
  value: number;
}

/**
 * One measure over the months, as a filled line. A single series, so no legend
 * -- the title names it. Used full-size for a headline trend and, with
 * `compact`, as a panel in a small-multiples grid where the axis titles would
 * only crowd it. Each chart scales its own y-axis, so a small series in a grid
 * keeps its shape; the panel's figure carries the magnitude.
 */
export function MonthlyAreaChart({
  title,
  unit,
  note,
  data,
  seriesName,
  color = SERIES[0],
  height = 240,
  compact = false,
}: {
  title: string;
  unit: string;
  note?: ReactNode;
  data: TrendDatum[];
  seriesName: string;
  color?: string;
  height?: number;
  compact?: boolean;
}) {
  const margin = compact
    ? { top: 6, right: 10, bottom: 18, left: 38 }
    : { top: 8, right: 12, bottom: 26, left: 52 };
  return (
    <ChartFrame title={title} unit={unit} {...(note === undefined ? {} : { note })} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={margin}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="month"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            tickFormatter={formatMonthKey}
            minTickGap={compact ? 34 : 24}
            {...(compact
              ? {}
              : { label: { value: 'MONTH', position: 'insideBottom', offset: -14, style: AXIS_LABEL } })}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactLkr}
            width={compact ? 38 : 48}
            // Headroom so a flat series does not run along the top edge.
            domain={[0, (max: number) => Math.ceil(max * 1.12)]}
            {...(compact
              ? {}
              : { label: { value: 'LKR', angle: -90, position: 'insideLeft', offset: -6, style: AXIS_LABEL } })}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
            content={makeTooltip((l) => formatMonthKey(l))}
          />
          <Area
            {...STATIC_MARK}
            type="monotone"
            dataKey="value"
            name={seriesName}
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.14}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
