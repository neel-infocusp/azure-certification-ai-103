import { useEffect, useRef } from 'react'
import type { RawEvent } from '../../types'
import { MAX_RAW_EVENTS } from '../../hooks/useChat'

/** How close to the bottom (px) counts as "following" the log. */
const FOLLOW_THRESHOLD_PX = 24

export function RawEventsTab({ events }: { events: RawEvent[] }) {
  const logRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  // Follow new events, unless the user scrolled up to read earlier ones.
  useEffect(() => {
    const el = logRef.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [events])

  if (events.length === 0) {
    return (
      <p className="placeholder">
        Send a message to see the live events sent by the model while it answers.
      </p>
    )
  }

  const onScroll = () => {
    const el = logRef.current
    if (!el) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
  }

  return (
    <div className="tab-body">
      <p className="note">
        {events.length} event{events.length === 1 ? '' : 's'} for the last turn
        {events.length >= MAX_RAW_EVENTS ? ` (showing the latest ${MAX_RAW_EVENTS})` : ''}.
      </p>
      <div className="event-log" ref={logRef} onScroll={onScroll} role="log" aria-label="Raw events">
        {events.map((event) => (
          <div key={event.seq} className="event-row">
            <span className="event-seq">{event.seq}</span>
            <span className="event-type">{event.type}</span>
            {event.summary && <span className="event-summary">{event.summary}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
