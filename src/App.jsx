import { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig';
import {
  collection, doc, setDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy, where
} from 'firebase/firestore';
import './App.css';

const USERS = ['Mum', 'Dad'];

function getNextDays(n = 14) {
  const days = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const date = new Date(d);
    date.setDate(d.getDate() + i);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      days.push(date.toISOString().split('T')[0]);
    }
  }
  return days;
}

function formatDate(date) {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getNZTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
}

function getDaysUntil(dateStr) {
  const today = getNZTime();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function isDropoffLocked(dateStr) {
  const nzNow = getNZTime();
  const daysUntil = getDaysUntil(dateStr);
  // Lock dropoff if it's today and past midday NZ time
  return daysUntil === 0 && nzNow.getHours() >= 12;
}

function isDayLocked(dateStr) {
  const nzNow = getNZTime();
  const daysUntil = getDaysUntil(dateStr);
  // Lock entire day if it's today and past 6pm NZ time, or if it's in the past
  return daysUntil < 0 || (daysUntil === 0 && nzNow.getHours() >= 18);
}

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [events, setEvents] = useState({});
  const [notes, setNotes] = useState({});
  const [newNote, setNewNote] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Mum');
  const [selectedDay, setSelectedDay] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [seenNotes, setSeenNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('seenNotes') || '{}'); } catch { return {}; }
  });
  const days = getNextDays(14);
  const prevNotesRef = useRef({});

  // Real-time sync for events
  useEffect(() => {
    return onSnapshot(collection(db, 'events'), snap => {
      const data = {};
      snap.docs.forEach(d => data[d.id] = d.data());
      setEvents(data);
    });
  }, []);

  // Real-time sync for notes (grouped by date)
  useEffect(() => {
    const q = query(collection(db, 'notes'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => {
      const data = {};
      snap.docs.forEach(d => {
        const note = { id: d.id, ...d.data() };
        if (!data[note.date]) data[note.date] = [];
        data[note.date].push(note);
      });

      // Check for new notes vs what we've seen before
      const newAlerts = [];
      Object.entries(data).forEach(([date, dateNotes]) => {
        dateNotes.forEach(note => {
          const prev = prevNotesRef.current[date];
          const wasntThere = !prev || !prev.find(n => n.id === note.id);
          if (wasntThere && prevNotesRef.current[date] !== undefined) {
            newAlerts.push(`📝 New note from ${note.author} for ${formatDate(date)}: "${note.text.substring(0, 40)}${note.text.length > 40 ? '...' : ''}"`);
          }
        });
      });

      if (newAlerts.length > 0) {
        setAlerts(prev => [...prev, ...newAlerts]);
      }

      prevNotesRef.current = data;
      setNotes(data);
    });
  }, []);

  // Check for unassigned days within 2 WORKING days
  useEffect(() => {
    const urgent = [];
    let workingDaysCount = 0;
    for (const date of days) {
      if (workingDaysCount > 2) break;
      if (isDayLocked(date)) continue;
      const event = events[date] || {};
      if (!event.dayOff) {
        workingDaysCount++;
        if (workingDaysCount <= 2) {
          if (!isDropoffLocked(date) && !event.dropoff) urgent.push(`⚠️ ${formatDate(date)}: Drop-off not assigned!`);
          if (!event.pickup) urgent.push(`⚠️ ${formatDate(date)}: Pick-up not assigned!`);
        }
      }
    }
    if (urgent.length > 0) {
      setAlerts(prev => {
        const existing = prev.filter(a => !a.startsWith('⚠️'));
        return [...existing, ...urgent];
      });
    }
  }, [events]);

  const dismissAlert = (index) => {
    setAlerts(prev => prev.filter((_, i) => i !== index));
  };

  // Get the most recent previous day's times as defaults
  function getPreviousTimes(currentDate) {
    const idx = days.indexOf(currentDate);
    for (let i = idx - 1; i >= 0; i--) {
      const prev = events[days[i]];
      if (prev && !prev.dayOff && (prev.dropoffTime || prev.pickupTime)) {
        return { dropoffTime: prev.dropoffTime || '', pickupTime: prev.pickupTime || '' };
      }
    }
    return { dropoffTime: '', pickupTime: '' };
  }

  const toggleDayOff = async (date) => {
    const current = events[date]?.dayOff || false;
    await setDoc(doc(db, 'events', date), { dayOff: !current }, { merge: true });
  };

  const cycleHoliday = async (date) => {
    const current = events[date]?.holidayType || 'none';
    const next = current === 'none' ? 'holiday' : current === 'holiday' ? 'other' : 'none';
    await setDoc(doc(db, 'events', date), {
      dayOff: next !== 'none',
      holidayType: next
    }, { merge: true });
  };

  const assignPickup = async (date, person) => {
    await setDoc(doc(db, 'events', date), { pickup: person }, { merge: true });
  };

  const assignDropoff = async (date, person) => {
    await setDoc(doc(db, 'events', date), { dropoff: person }, { merge: true });
  };

  const updateTime = async (date, field, value) => {
    await setDoc(doc(db, 'events', date), { [field]: value }, { merge: true });
  };

  const sendNote = async () => {
    if (!newNote.trim() || !selectedDay) return;
    await addDoc(collection(db, 'notes'), {
      text: newNote,
      author: noteAuthor,
      date: selectedDay,
      createdAt: serverTimestamp()
    });
    setNewNote('');
    // Mark as seen for sender
    const updated = { ...seenNotes, [selectedDay]: (notes[selectedDay]?.length || 0) + 1 };
    setSeenNotes(updated);
    localStorage.setItem('seenNotes', JSON.stringify(updated));
  };

  const markNotesSeen = (date) => {
    const count = notes[date]?.length || 0;
    const updated = { ...seenNotes, [date]: count };
    setSeenNotes(updated);
    localStorage.setItem('seenNotes', JSON.stringify(updated));
  };

  const hasUnseenNotes = (date) => {
    const total = notes[date]?.length || 0;
    const seen = seenNotes[date] || 0;
    return total > seen;
  };

  const openNotes = (date) => {
    setSelectedDay(date);
    setTab('notes');
    markNotesSeen(date);
  };

  return (
    <div className="app">
      <header>
        <h1>🌟 Jeanie's Daycare</h1>
      </header>

      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((alert, i) => (
            <div key={i} className={`alert ${alert.startsWith('⚠️') ? 'alert-warning' : 'alert-info'}`}>
              <span>{alert}</span>
              <button onClick={() => dismissAlert(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <nav className="tabs">
        <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>📅 Schedule</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => { setTab('notes'); if (!selectedDay) setSelectedDay(days[0]); }}>
          📝 Notes
        </button>
      </nav>

      {tab === 'schedule' && (
        <div className="schedule">
          {days.map(date => {
            const event = events[date] || {};
            const dayOff = event.dayOff || false;
            const holidayType = event.holidayType || 'none';
            const daysUntil = getDaysUntil(date);
            const locked = isDayLocked(date);
            const dropoffLocked = isDropoffLocked(date);
            const isUrgent = !locked && daysUntil <= 2 && !dayOff;
            const prevTimes = getPreviousTimes(date);
            const dropoffTime = event.dropoffTime || prevTimes.dropoffTime;
            const pickupTime = event.pickupTime || prevTimes.pickupTime;
            const noteCount = notes[date]?.length || 0;
            const unseen = hasUnseenNotes(date);

            return (
<div key={date} className={`day-card ${dayOff ? 'day-off' : ''} ${isUrgent ? 'urgent' : ''} ${locked ? 'locked' : ''}`}>                <div className="day-header">
                  <div className="day-header-left">
                    <span className="day-label">{formatDate(date)}</span>
                    {daysUntil === 0 && <span className="badge today">Today</span>}
                    {daysUntil === 1 && <span className="badge tomorrow">Tomorrow</span>}
                  </div>
                  <div className="day-header-right">
                    <button
                      className={`notes-btn ${unseen ? 'has-notes' : noteCount > 0 ? 'has-notes-read' : ''}`}
                      onClick={() => openNotes(date)}
                    >
                      📝 {noteCount > 0 ? noteCount : '+'}
                    </button>
                    <button
                      className={`holiday-btn holiday-${holidayType}`}
                      onClick={() => cycleHoliday(date)}
                    >
                      {holidayType === 'none' ? '📅' : holidayType === 'holiday' ? '🎉 Holiday' : '🚫 No Daycare'}
                    </button>
                  </div>
                </div>

                {!dayOff && (
                  <div className="assignments">
                    <div className="assignment-row">
                      <span>🌅 Drop-off:</span>
                      {dropoffLocked ? (
                        <span className="locked-label">Past midday — locked</span>
                      ) : (
                        <div className="person-buttons">
                          {USERS.map(u => (
                            <button key={u} className={event.dropoff === u ? 'selected' : ''} onClick={() => assignDropoff(date, u)}>{u}</button>
                          ))}
                          {!event.dropoff && <span className="warning">⚠️ Unassigned</span>}
                        </div>
                      )}
                    </div>
                    <div className="time-row">
                      <span>🕐 Time:</span>
                      <input
                        type="time"
                        value={dropoffTime}
                        onChange={e => updateTime(date, 'dropoffTime', e.target.value)}
                        className="time-input"
                      />
                    </div>
                    <div className="assignment-row">
                      <span>🌆 Pick-up:</span>
                      <div className="person-buttons">
                        {USERS.map(u => (
                          <button key={u} className={event.pickup === u ? 'selected' : ''} onClick={() => assignPickup(date, u)}>{u}</button>
                        ))}
                        {!event.pickup && <span className="warning">⚠️ Unassigned</span>}
                      </div>
                    </div>
                    <div className="time-row">
                      <span>🕐 Time:</span>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={e => updateTime(date, 'pickupTime', e.target.value)}
                        className="time-input"
                      />
                    </div>
                  </div>
                )}

                {dayOff && (
                  <div className="day-off-label">
                    {holidayType === 'holiday' ? '🎉 Public Holiday' : '🚫 No Daycare'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'notes' && (
        <div className="notes">
          <div className="day-selector">
            <label>Notes for:</label>
            <select value={selectedDay || days[0]} onChange={e => { setSelectedDay(e.target.value); markNotesSeen(e.target.value); }}>
              {days.map(date => (
                <option key={date} value={date}>
                  {formatDate(date)}{hasUnseenNotes(date) ? ' 🔴' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="notes-list">
            {(notes[selectedDay] || []).length === 0 && (
              <div className="no-notes">No notes for this day yet</div>
            )}
            {(notes[selectedDay] || []).map(note => (
              <div key={note.id} className="note-card">
                <div className="note-meta">
                  <strong>{note.author}</strong>
                  <span>{note.createdAt?.toDate?.().toLocaleString('en-NZ') || 'just now'}</span>
                </div>
                <p>{note.text}</p>
              </div>
            ))}
          </div>

          <div className="note-input">
            <select value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}>
              {USERS.map(u => <option key={u}>{u}</option>)}
            </select>
            <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder={`Leave a note for ${formatDate(selectedDay || days[0])}...`} rows={3} />
            <button onClick={sendNote}>Send Note 📨</button>
          </div>
        </div>
      )}
    </div>
  );
}