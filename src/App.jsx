import { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig';
import {
  collection, doc, setDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import './App.css';

const USERS = ['Mum', 'Dad'];

function getNZTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
}

function getNextDays(n = 14) {
  const days = [];
  const d = getNZTime();
  for (let i = 0; i < n; i++) {
    const date = new Date(d);
    date.setDate(d.getDate() + i);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      const dateStr = date.toISOString().split('T')[0];
      if (!isDayLocked(dateStr)) {
        days.push(dateStr);
      }
    }
  }
  return days;
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
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
  return daysUntil === 0 && nzNow.getHours() >= 12;
}

function isDayLocked(dateStr) {
  const nzNow = getNZTime();
  const daysUntil = getDaysUntil(dateStr);
  return daysUntil < 0 || (daysUntil === 0 && nzNow.getHours() >= 18);
}

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [events, setEvents] = useState({});
  const [notes, setNotes] = useState({});
  const [newNote, setNewNote] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || null;
  });
  const [showUserSelect, setShowUserSelect] = useState(() => {
    return !localStorage.getItem('currentUser');
  });
  const [seenNotes, setSeenNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('seenNotes') || '{}'); } catch { return {}; }
  });

  const days = getNextDays(14);
  const effectiveSelectedDay = selectedDay || days[0];
  const prevNotesRef = useRef({});
  const touchStartY = useRef(0);

  // Real-time sync for events
  useEffect(() => {
    return onSnapshot(collection(db, 'events'), snap => {
      const data = {};
      snap.docs.forEach(d => data[d.id] = d.data());
      setEvents(data);
    });
  }, []);

  // Real-time sync for notes grouped by date
  useEffect(() => {
    const q = query(collection(db, 'notes'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => {
      const data = {};
      snap.docs.forEach(d => {
        const note = { id: d.id, ...d.data() };
        if (!data[note.date]) data[note.date] = [];
        data[note.date].push(note);
      });

      // Alert for new notes from the other person
      const newAlerts = [];
      Object.entries(data).forEach(([date, dateNotes]) => {
        dateNotes.forEach(note => {
          const prev = prevNotesRef.current[date];
          const wasntThere = !prev || !prev.find(n => n.id === note.id);
          const fromOther = currentUser ? note.author !== currentUser : true;
          if (wasntThere && prevNotesRef.current[date] !== undefined && fromOther) {
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
  }, [currentUser]);

  // Alerts for unassigned days within 2 working days
  useEffect(() => {
    const urgent = [];
    let workingDaysCount = 0;
    for (const date of days) {
      if (workingDaysCount >= 2) break;
      if (isDayLocked(date)) continue;
      const event = events[date] || {};
      if (!event.dayOff) {
        workingDaysCount++;
        if (!isDropoffLocked(date) && !event.dropoff) urgent.push(`⚠️ ${formatDate(date)}: Drop-off not assigned!`);
        if (!event.pickup) urgent.push(`⚠️ ${formatDate(date)}: Pick-up not assigned!`);
      }
    }
    setAlerts(prev => {
      const existing = prev.filter(a => !a.startsWith('⚠️'));
      return [...existing, ...urgent];
    });
  }, [events]);

  const dismissAlert = (index) => {
    setAlerts(prev => prev.filter((_, i) => i !== index));
  };

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

  const cycleHoliday = async (date) => {
    const current = events[date]?.holidayType || 'none';
    const next = current === 'none' ? 'holiday' : current === 'holiday' ? 'other' : 'none';
    await setDoc(doc(db, 'events', date), {
      dayOff: next !== 'none',
      holidayType: next
    }, { merge: true });
  };

  const assignPickup = async (date, person) => {
    const current = events[date]?.pickup;
    const newValue = current === person ? null : person;
    const update = { pickup: newValue };
    if (newValue && !events[date]?.pickupTime) update.pickupTime = '16:00';
    await setDoc(doc(db, 'events', date), update, { merge: true });
  };

  const assignDropoff = async (date, person) => {
    const current = events[date]?.dropoff;
    const newValue = current === person ? null : person;
    const update = { dropoff: newValue };
    if (newValue && !events[date]?.dropoffTime) update.dropoffTime = '07:30';
    await setDoc(doc(db, 'events', date), update, { merge: true });
  };

  const updateTime = async (date, field, value) => {
    await setDoc(doc(db, 'events', date), { [field]: value }, { merge: true });
  };

  const sendNote = async () => {
    if (!newNote.trim() || !effectiveSelectedDay) return;
    await addDoc(collection(db, 'notes'), {
      text: newNote,
      author: currentUser || 'Unknown',
      date: effectiveSelectedDay,
      createdAt: serverTimestamp()
    });
    setNewNote('');
    const updated = { ...seenNotes, [effectiveSelectedDay]: (notes[effectiveSelectedDay]?.length || 0) + 1 };
    setSeenNotes(updated);
    localStorage.setItem('seenNotes', JSON.stringify(updated));
  };

  const selectUser = (user) => {
    setCurrentUser(user);
    setShowUserSelect(false);
    localStorage.setItem('currentUser', user);
  };

  const switchUser = () => {
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
    setShowUserSelect(true);
  };

  const markNotesSeen = (date) => {
    const otherNotes = (notes[date] || []).filter(n => n.author !== currentUser);
    const updated = { ...seenNotes, [date]: otherNotes.length };
    setSeenNotes(updated);
    localStorage.setItem('seenNotes', JSON.stringify(updated));
  };

  const hasUnseenNotes = (date) => {
    const otherNotes = (notes[date] || []).filter(n => n.author !== currentUser);
    const seenCount = seenNotes[date] || 0;
    return otherNotes.length > seenCount;
  };

  const openNotes = (date) => {
    setSelectedDay(date);
    setTab('notes');
    markNotesSeen(date);
  };

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 80 && window.scrollY === 0) {
      window.location.reload();
    }
  };

  if (showUserSelect) {
    return (
      <div className="user-select-screen">
        <div className="user-select-card">
          <div className="user-select-icon">🌟</div>
          <h1>Jeanie's Daycare</h1>
          <p>Who are you?</p>
          <div className="user-select-buttons">
            {USERS.map(u => (
              <button key={u} onClick={() => selectUser(u)}>{u}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <header>
        <div className="header-top">
          <h1>🌟 Jeanie's Daycare</h1>
          <button className="switch-user-btn" onClick={switchUser}>
            {currentUser} ⇄
          </button>
        </div>
      </header>

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
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => { setTab('notes'); markNotesSeen(effectiveSelectedDay); }}>
          📝 Notes {Object.keys(notes).some(d => hasUnseenNotes(d)) ? '🔴' : ''}
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
            const dropoffTime = event.dropoffTime || '';
            const pickupTime = event.pickupTime || '';
            const noteCount = notes[date]?.length || 0;
            const unseen = hasUnseenNotes(date);

            return (
              <div key={date} className={`day-card ${dayOff ? 'day-off' : ''} ${isUrgent ? 'urgent' : ''} ${locked ? 'locked' : ''}`}>
                <div className="day-header">
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
                    {!dropoffLocked && (
                      <div className="time-row">
                        <span>🕐 Time:</span>
                        <input type="time" value={dropoffTime} onChange={e => updateTime(date, 'dropoffTime', e.target.value)} className="time-input" />
                      </div>
                    )}
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
                      <input type="time" value={pickupTime} onChange={e => updateTime(date, 'pickupTime', e.target.value)} className="time-input" />
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
            <select value={effectiveSelectedDay} onChange={e => { setSelectedDay(e.target.value); markNotesSeen(e.target.value); }}>
              {days.map(date => (
                <option key={date} value={date}>
                  {formatDate(date)}{hasUnseenNotes(date) ? ' 🔴' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="notes-list">
            {(notes[effectiveSelectedDay] || []).length === 0 && (
              <div className="no-notes">No notes for this day yet</div>
            )}
            {(notes[effectiveSelectedDay] || []).map(note => (
              <div key={note.id} className={`note-card ${note.author === currentUser ? 'note-mine' : 'note-theirs'}`}>
                <div className="note-meta">
                  <strong>{note.author}</strong>
                  <span>{note.createdAt?.toDate?.().toLocaleString('en-NZ') || 'just now'}</span>
                </div>
                <p>{note.text}</p>
              </div>
            ))}
          </div>

          <div className="note-input">
            <div className="note-from">Sending as: <strong>{currentUser}</strong></div>
            <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Type your note here..." rows={3} />
            <button onClick={sendNote}>Send Note 📨</button>
          </div>
        </div>
      )}
    </div>
  );
}