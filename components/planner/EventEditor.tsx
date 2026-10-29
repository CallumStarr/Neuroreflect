'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, Trash2 } from 'lucide-react';
import { getDB } from '@/lib/db';
import { parseWhen, stripWhen } from '@/lib/nl-date';
import { deleteEvent, saveEvent } from '@/lib/planner';
import { useUI } from '@/lib/store';
import type { Forecast, LocalDay, PlanEvent } from '@/lib/types';
import { addDays, localDayOf, uid } from '@/lib/util';
import Dialog from '../ui/Dialog';
import { fieldCls, labelCls, ReminderSelect, RepeatPicker } from './shared';

interface Props {
  event: PlanEvent;
  /** The occurrence that was clicked, for "delete just this one". */
  occurrenceDay?: LocalDay;
  isNew: boolean;
  onClose: () => void;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function EventEditor({ event, occurrenceDay, isNew, onClose }: Props) {
  const [draft, setDraft] = useState<PlanEvent>(event);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [dread, setDread] = useState(50);
  const values = useLiveQuery(() => getDB().coreValues.orderBy('order').toArray(), []) ?? [];
  const forecast = useLiveQuery(() => (draft.forecastId ? getDB().forecasts.get(draft.forecastId) : undefined), [draft.forecastId]);
  const defaultReminder = useUI((s) => s.settings.planner.defaultReminder);
  const set = (patch: Partial<PlanEvent>) => setDraft((d) => ({ ...d, ...patch }));
  const allDay = draft.startTime === null;

  // Typing "Dentist Thursday 3pm" into a new event's title fills in the date and time.
  const parsedTitle = isNew ? parseWhen(draft.title, new Date()) : null;
  const applyParsed = () => {
    if (!parsedTitle) return;
    const title = stripWhen(draft.title, parsedTitle);
    const startDay = parsedTitle.day ?? draft.startDay;
    const startTime = parsedTitle.time ?? draft.startTime;
    set({
      title,
      startDay,
      endDay: startDay,
      startTime,
      endTime: parsedTitle.endTime ?? (startTime ? addMinutes(startTime, 60) : null),
      repeat: parsedTitle.repeat ?? draft.repeat,
      reminderMinutes: startTime && draft.reminderMinutes === null && isNew ? defaultReminder : draft.reminderMinutes,
    });
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      setError('Give it a name.');
      return;
    }
    if (draft.endDay < draft.startDay || (draft.endDay === draft.startDay && draft.startTime && draft.endTime && draft.endTime < draft.startTime)) {
      setError('It ends before it starts.');
      return;
    }
    let forecastId = draft.forecastId;
    if (forecastOpen && !forecastId && draft.startDay >= localDayOf()) {
      const f: Forecast = {
        id: uid('f'),
        entryId: null,
        eventName: title,
        targetDate: draft.startDay,
        predictedDread: dread,
        predictedCoping: 50,
        worstCase: '',
        actualImpact: null,
        actualCoping: null,
        actualNote: '',
        calibratedAt: null,
        createdAt: new Date().toISOString(),
      };
      await getDB().forecasts.add(f);
      forecastId = f.id;
    }
    await saveEvent({ ...draft, title, forecastId });
    onClose();
  };

  return (
    <Dialog label={isNew ? 'New event' : 'Edit event'} title={isNew ? 'New event' : 'Event'} onClose={onClose} width="w-[540px]">
      <div className="space-y-4">
        <div>
          <label htmlFor="ev-title" className={labelCls}>
            What
          </label>
          <input
            id="ev-title"
            autoFocus
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            onBlur={applyParsed}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (parsedTitle) applyParsed();
                else void save();
              }
            }}
            placeholder="Dentist on Thursday at 3pm"
            className={`${fieldCls} mt-1`}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-paper-100">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) =>
                e.target.checked
                  ? set({ startTime: null, endTime: null, reminderMinutes: draft.reminderMinutes === null ? null : 0 })
                  : set({ startTime: '09:00', endTime: '10:00' })
              }
              className="accent-[#e0aa4a]"
            />
            All day
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ev-start" className={labelCls}>
              Starts
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="ev-start"
                type="date"
                value={draft.startDay}
                onChange={(e) => {
                  const startDay = e.target.value || draft.startDay;
                  const span = Math.max(0, (new Date(draft.endDay).getTime() - new Date(draft.startDay).getTime()) / 86400000);
                  set({ startDay, endDay: addDays(startDay, span) });
                }}
                className={`${fieldCls} [color-scheme:dark]`}
              />
              {!allDay && (
                <input aria-label="Start time" type="time" value={draft.startTime ?? ''} onChange={(e) => set({ startTime: e.target.value || '09:00' })} className={`${fieldCls} w-[110px] [color-scheme:dark]`} />
              )}
            </div>
          </div>
          <div>
            <label htmlFor="ev-end" className={labelCls}>
              Ends
            </label>
            <div className="mt-1 flex gap-2">
              <input id="ev-end" type="date" value={draft.endDay} min={draft.startDay} onChange={(e) => set({ endDay: e.target.value || draft.startDay })} className={`${fieldCls} [color-scheme:dark]`} />
              {!allDay && <input aria-label="End time" type="time" value={draft.endTime ?? ''} onChange={(e) => set({ endTime: e.target.value || null })} className={`${fieldCls} w-[110px] [color-scheme:dark]`} />}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ev-repeat" className={labelCls}>
              Repeat
            </label>
            <div className="mt-1">
              <RepeatPicker id="ev-repeat" value={draft.repeat} onChange={(repeat) => set({ repeat })} day={draft.startDay} />
            </div>
          </div>
          <div>
            <label htmlFor="ev-remind" className={labelCls}>
              Reminder
            </label>
            <div className="mt-1">
              <ReminderSelect id="ev-remind" value={draft.reminderMinutes} onChange={(reminderMinutes) => set({ reminderMinutes })} allDay={allDay} />
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="ev-where" className={labelCls}>
            Where (optional)
          </label>
          <input id="ev-where" value={draft.location} onChange={(e) => set({ location: e.target.value })} className={`${fieldCls} mt-1`} />
        </div>

        <div className="rounded-xl border border-ink-700 p-3">
          <label className="flex items-start gap-2.5 text-[13px] text-paper-100">
            <input type="checkbox" checked={draft.big} onChange={(e) => set({ big: e.target.checked })} className="mt-0.5 accent-[#e0aa4a]" />
            <span>
              This one matters to me
              <span className="block text-[12px] leading-5 text-paper-500">Beforehand, the journal offers a worry dump and a plan for the feeling. Afterwards, it asks how it went.</span>
            </span>
          </label>
          {draft.big && !forecast && draft.startDay >= localDayOf() && (
            <div className="mt-3 border-t border-ink-800 pt-3">
              {!forecastOpen ? (
                <button type="button" onClick={() => setForecastOpen(true)} className="inline-flex items-center gap-1.5 text-[12.5px] text-dusk-300 hover:text-dusk-200">
                  <CalendarClock size={13} /> Forecast how it will feel, and check afterwards
                </button>
              ) : (
                <div>
                  <label htmlFor="ev-dread" className="flex justify-between text-[12.5px] text-paper-100">
                    How much dread do you expect? <span className="nr-num">{dread}</span>
                  </label>
                  <input id="ev-dread" type="range" min={0} max={100} step={5} value={dread} onChange={(e) => setDread(Number(e.target.value))} className="nr-range mt-2 w-full" />
                  <p className="mt-1 text-[11.5px] text-paper-500">Saved with the event. The day after, you&apos;ll be asked how it actually felt.</p>
                </div>
              )}
            </div>
          )}
          {forecast && <p className="mt-2 text-[12px] text-paper-500">Forecast: dread {forecast.predictedDread}{forecast.calibratedAt ? `, checked afterwards at ${forecast.actualImpact}` : ', checked the day after'}.</p>}
        </div>

        {values.length > 0 && (
          <div>
            <label htmlFor="ev-value" className={labelCls}>
              Plan one thing that matters
            </label>
            <select id="ev-value" value={draft.valueId ?? ''} onChange={(e) => set({ valueId: e.target.value || null })} className={`${fieldCls} mt-1 [color-scheme:dark]`}>
              <option value="">Not linked to a value</option>
              {values.map((v) => (
                <option key={v.id} value={v.id}>
                  For {v.label.toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="ev-notes" className={labelCls}>
            Notes
          </label>
          <textarea id="ev-notes" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className={`${fieldCls} mt-1 resize-none`} />
        </div>
        {error && <p className="text-[12.5px] text-rose-300">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
          {!isNew ? (
            confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                {event.repeat && occurrenceDay && (
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteEvent(event.id, occurrenceDay);
                      onClose();
                    }}
                    className="rounded-lg border border-rose-400/50 px-2.5 py-1.5 text-[12.5px] text-rose-300 hover:bg-rose-400/10"
                  >
                    Just this one
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await deleteEvent(event.id);
                    onClose();
                  }}
                  className="rounded-lg bg-rose-400 px-2.5 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-rose-300"
                >
                  {event.repeat ? 'Every one' : 'Delete'}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-800">
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" aria-label="Delete event" onClick={() => setConfirmDelete(true)} className="rounded-lg px-2.5 py-1.5 text-paper-500 hover:bg-ink-800 hover:text-rose-300">
                <Trash2 size={14} />
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
              {isNew ? 'Add to planner' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
