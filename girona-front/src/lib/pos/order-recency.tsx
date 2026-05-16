"use client";

import { Tooltip } from "@/components/ui/tooltip";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { HiOutlineBell, HiOutlineClock } from "react-icons/hi";

dayjs.extend(utc);
dayjs.extend(timezone);

export const COLOMBIA_TZ = "America/Bogota";
export const POS_RECENT_ORDER_MINUTES = 10;

export function toColombiaTime(value?: string | null) {
  if (!value) return null;
  const hasTzOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  if (hasTzOffset) {
    const withOffset = dayjs(value);
    return withOffset.isValid() ? withOffset.tz(COLOMBIA_TZ) : null;
  }
  const asBogota = dayjs.tz(value, COLOMBIA_TZ);
  return asBogota.isValid() ? asBogota : null;
}

export function colombiaNow() {
  return dayjs().tz(COLOMBIA_TZ);
}

export type OrderRecencyLevel = "hot" | "today";

export function orderRecencyAnchor(order: {
  status: string;
  opened_at: string;
  closed_at?: string | null;
}) {
  if (order.status === "closed" || order.status === "void") {
    return toColombiaTime(order.closed_at ?? order.opened_at);
  }
  return toColombiaTime(order.opened_at);
}

export function getOrderRecencyLevel(
  order: { status: string; opened_at: string; closed_at?: string | null },
  now: dayjs.Dayjs,
): OrderRecencyLevel | null {
  const anchor = orderRecencyAnchor(order);
  if (!anchor?.isValid()) return null;
  const minutesAgo = now.diff(anchor, "minute", true);
  if (minutesAgo >= 0 && minutesAgo <= POS_RECENT_ORDER_MINUTES) return "hot";
  if (anchor.isSame(now, "day")) return "today";
  return null;
}

export function latestOrderIdByTime<T extends { id: number }>(
  list: T[],
  getTime: (item: T) => ReturnType<typeof toColombiaTime>,
): number | null {
  if (list.length === 0) return null;
  let best = list[0];
  for (const candidate of list) {
    const tCandidate = getTime(candidate);
    const tBest = getTime(best);
    if (tCandidate?.isValid() && tBest?.isValid()) {
      if (tCandidate.isAfter(tBest) || (tCandidate.isSame(tBest) && candidate.id > best.id)) {
        best = candidate;
      }
    } else if (candidate.id > best.id) {
      best = candidate;
    }
  }
  return best.id;
}

export function OrderRecencyIndicator({
  level,
  isLatest,
}: {
  level: OrderRecencyLevel | null;
  isLatest?: boolean;
}) {
  if (!level && !isLatest) return null;

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {isLatest ? (
        <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Último
        </span>
      ) : null}
      {level === "hot" ? (
        <Tooltip label={`Reciente (últimos ${POS_RECENT_ORDER_MINUTES} min)`}>
          <span className="relative inline-flex h-5 w-5 shrink-0">
            <span
              aria-hidden
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFA70B] opacity-75"
            />
            <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#FFA70B] text-white">
              <HiOutlineBell className="h-3 w-3" />
            </span>
          </span>
        </Tooltip>
      ) : null}
      {level === "today" ? (
        <Tooltip label="Pedido de hoy">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#219653]/15 text-[#219653]">
            <HiOutlineClock className="h-3.5 w-3.5" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
