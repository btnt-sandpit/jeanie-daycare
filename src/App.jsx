import { useState, useEffect } from 'react';
import { db } from './firebaseConfig';
import {
  collection, doc, setDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy
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

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [events, setEvents] = useState({});
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Mum');
  const days = getNextDays(14);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events'), snap => {
      const data = {};
      snap.docs.forEach(d => data[d.id] = d.data());
      setEvents(data);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'notes'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const toggleDayOff = async (date) => {
    const current = events[date]?.dayOff || false;
    await setDoc(doc(db, 'events', date), { dayOff: !current }, { merge: true });
  };

  const assignPickup = async (date, person) => {
    await setDoc(doc(db, 'events', date), { pickup: person }, { merge: true });
  };

  const assignDropoff = async (date, person) => {
    await setDoc(doc(db, 'events', date), { dropoff: person }, { merge: true });
  };

  const sendNote = async () => {
    if (!newNote.trim()) return;
    await addDoc(collection(db, 'notes'), {
      text: newNote,
      author: noteAuthor,
      createdAt: serverTimestamp()
    });
    setNewNote('');
  };

  return (
    <div className="app">
      <header>
        <h1>🌟 Jeanie's Daycare</h1>
      </header>

      <nav className="tabs">
        <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>📅 Schedule</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>📝 Notes</button>
      </nav>

      {tab === 'schedule' && (
        <div className="schedule">
          {days.map(date => {
            const event = events[date] || {};
            const dayOff = event.dayOff || false;
            const d = new Date(date + 'T12:00:00');
            const label = d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
            return (
              <div key={date} className={`day-card ${dayOff ? 'day-off' : ''}`}>
                <div className="day-header">
                  <span className="day-label">{label}</span>
                  <label className="toggle">
                    <input type="checkbox" checked={dayOff} onChange={() => toggleDayOff(date)} />
                    <span>No Daycare</span>
                  </label>
                </div>
                {!dayOff && (
                  <div className="assignments">
                    <div className="assignment-row">
                      <span>🌅 Drop-off:</span>
                      <div className="person-buttons">
                        {USERS.map(u => (
                          <button key={u} className={event.dropoff === u ? 'selected' : ''} onClick={() => assignDropoff(date, u)}>{u}</button>
                        ))}
                        {!event.dropoff && <span className="warning">⚠️ Unassigned</span>}
                      </div>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'notes' && (
        <div className="notes">
          <div className="note-input">
            <select value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}>
              {USERS.map(u => <option key={u}>{u}</option>)}
            </select>
            <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Leave a note for each other..." rows={3} />
            <button onClick={sendNote}>Send Note 📨</button>
          </div>
          <div className="notes-list">
            {notes.map(note => (
              <div key={note.id} className="note-card">
                <div className="note-meta">
                  <strong>{note.author}</strong>
                  <span>{note.createdAt?.toDate?.().toLocaleString('en-NZ') || 'just now'}</span>
                </div>
                <p>{note.text}</p>
              </div>
            ))}
          </div>
        </div>
        )}
    </div>
  );
}