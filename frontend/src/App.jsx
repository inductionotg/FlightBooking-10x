import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2,
  ChevronDown, Clock3, Compass, LayoutDashboard, LoaderCircle, LogOut, Mail,
  MapPin, Menu, Plane, PlaneLanding, PlaneTakeoff, Plus, RefreshCw, Search,
  ShieldCheck, SlidersHorizontal, Sparkles, Ticket, UsersRound, X
} from 'lucide-react';
import { api } from './api.js';

const SESSION_KEY = 'aeris-session';
const JOURNEYS_KEY = 'aeris-journeys';
const AIRLINES = { AI: 'Air India', '6E': 'IndiGo', QP: 'Akasa Air' };
const airlineName = number => AIRLINES[String(number || '').match(/^(AI|6E|QP)\s/i)?.[1]?.toUpperCase()] || 'Flight';
const airportCode = airport => airport?.name.match(/\(([A-Z]{3})\)$/)?.[1];
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const date = value => value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const time = value => value ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const localDateKey = value => {
  const instant = new Date(value);
  return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
};
const flightDuration = flight => {
  const minutes = Math.round((new Date(flight.arrivalTime) - new Date(flight.departureTime)) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—';
};
const initialSearch = { departureAirportId: '', arrivalAirportId: '', date: '', minPrice: '', maxPrice: '' };
const initialFlight = { flightNumber: '', airplaneId: '', departureAirportId: '', arrivalAirportId: '', departureTime: '', arrivalTime: '', price: '' };

function readStored(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>{children}</label>;
}

function Button({ children, variant = 'primary', className = '', busy = false, ...props }) {
  const variants = {
    primary: 'bg-[#e8774f] text-white hover:bg-[#db6741] shadow-[0_12px_24px_rgba(232,119,79,.18)]',
    dark: 'bg-[#092843] text-white hover:bg-[#123b5b]',
    soft: 'bg-[#eef4f7] text-[#153b56] hover:bg-[#dfeaf0]',
    outline: 'border border-slate-200 bg-white text-[#17374d] hover:border-[#8bb2c4]'
  };
  return <button {...props} disabled={busy || props.disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}>{busy && <LoaderCircle size={17} className="animate-spin" />}{children}</button>;
}

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'signup') await api.signUp(email.trim(), password);
      const token = (await api.signIn(email.trim(), password)).data;
      const principal = (await api.me(token)).data;
      if (!Number.isInteger(principal?.id)) throw new Error('Sign-in succeeded, but the user ID was unavailable.');
      onSuccess({ token, ...principal });
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Account access" onMouseDown={event => event.stopPropagation()} className="modal-card max-w-md">
      <div className="mb-8 flex items-start justify-between"><div className="brand-mark"><Plane size={22} strokeWidth={2.2} /></div><button onClick={onClose} aria-label="Close" className="icon-button"><X size={20} /></button></div>
      <p className="eyebrow">YOUR JOURNEY STARTS HERE</p>
      <h2 className="mt-2 font-display text-4xl text-[#0c2a42]">{mode === 'signin' ? 'Welcome back.' : 'Join the journey.'}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-500">{mode === 'signin' ? 'Sign in to reserve a flight and view your account’s booking history.' : 'Create an account, then we’ll sign you in automatically.'}</p>
      <div className="mt-7 grid grid-cols-2 rounded-xl bg-[#edf2f5] p-1 text-sm font-semibold">
        {[['signin', 'Sign in'], ['signup', 'Create account']].map(([value, label]) => <button key={value} type="button" onClick={() => { setMode(value); setError(''); }} className={`rounded-lg py-2.5 transition ${mode === value ? 'bg-white text-[#0b2a42] shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email address"><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="input" placeholder="you@example.com" /></Field>
        <Field label="Password"><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={event => setPassword(event.target.value)} className="input" placeholder="Enter your password" /></Field>
        {error && <p role="alert" className="alert-error">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></Button>
      </form>
      <p className="mt-5 text-center text-xs leading-5 text-slate-400">Local development account · No payments are collected</p>
    </div>
  </div>;
}

function FlightCard({ flight, origin, destination, onSelect }) {
  const soldOut = Number(flight.totalSeats) < 1;
  return <article className="flight-card group">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2 text-xs font-bold tracking-[0.08em] text-[#0c5773]"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e8f4f5]"><Plane size={15} /></span>{airlineName(flight.flightNumber)} · {flight.flightNumber}</div>
      <span className="text-xs font-medium text-slate-400">{date(flight.departureTime)} · {flight.boardingGate ? `Gate ${flight.boardingGate}` : 'Gate assigned later'}</span>
    </div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-6">
      <div><p className="text-2xl font-bold tracking-tight text-[#0b2a42]">{time(flight.departureTime)}</p><p className="mt-1 text-sm font-semibold text-[#173c54]">{origin?.cityName || origin?.name || `Airport ${flight.departureAirportId}`}</p><p className="text-xs text-slate-400">{airportCode(origin) || 'Departure'}</p></div>
      <div className="min-w-28 text-center"><p className="mb-2 text-[11px] font-semibold text-slate-400">{flightDuration(flight)}</p><div className="flex items-center gap-1 text-[#5fa8b5]"><span className="h-1.5 w-1.5 rounded-full border border-current" /><span className="h-px w-10 bg-[#a6cbd0]" /><Plane size={15} className="-rotate-45" /><span className="h-px w-10 bg-[#a6cbd0]" /><span className="h-1.5 w-1.5 rounded-full bg-current" /></div><p className="mt-2 text-[11px] font-semibold text-slate-400">Direct flight</p></div>
      <div className="text-right"><p className="text-2xl font-bold tracking-tight text-[#0b2a42]">{time(flight.arrivalTime)}</p><p className="mt-1 text-sm font-semibold text-[#173c54]">{destination?.cityName || destination?.name || `Airport ${flight.arrivalAirportId}`}</p><p className="text-xs text-slate-400">{airportCode(destination) || 'Arrival'}</p></div>
    </div>
    <div className="flex items-end justify-between border-t border-slate-100 pt-4"><div><p className={`text-xs font-semibold ${soldOut ? 'text-rose-500' : 'text-[#358b78]'}`}>{soldOut ? 'Sold out' : `${flight.totalSeats} seats available`}</p><div className="mt-1 flex items-baseline gap-1"><strong className="text-2xl tracking-tight text-[#092843]">{money(flight.price)}</strong><span className="text-xs text-slate-400">/ seat</span></div></div><Button onClick={onSelect} disabled={soldOut} variant="dark" className="!px-4 !py-2.5">View flight <ArrowUpRight size={16} /></Button></div>
  </article>;
}

function BookingPanel({ flight, origin, destination, email, onClose, onBook, busy, error, feedback, onTrips }) {
  const [seats, setSeats] = useState(1);
  const [notificationEmail, setNotificationEmail] = useState(email || '');
  useEffect(() => { setSeats(1); setNotificationEmail(email || ''); }, [flight?.id, email]);
  if (!flight) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <aside role="dialog" aria-modal="true" aria-label="Flight booking" onMouseDown={event => event.stopPropagation()} className="drawer-card">
      <div className="flex items-center justify-between"><span className="eyebrow">FLIGHT DETAILS</span><button onClick={onClose} aria-label="Close" className="icon-button"><X size={20} /></button></div>
      <h2 className="mt-5 font-display text-4xl leading-tight text-[#0a2a42]">Your next chapter<br /><span className="text-[#e8774f]">is in the air.</span></h2>
      <div className="mt-8 rounded-2xl bg-[#092843] p-6 text-white">
        <div className="flex items-center justify-between text-xs font-bold tracking-[0.1em] text-[#9ccbd3]"><span>{airlineName(flight.flightNumber)} · {flight.flightNumber}</span><span>{date(flight.departureTime)}</span></div>
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div><p className="text-2xl font-bold">{time(flight.departureTime)}</p><p className="mt-1 text-sm text-slate-200">{origin?.cityName || origin?.name || `Airport ${flight.departureAirportId}`} {airportCode(origin)}</p></div><Plane size={21} className="-rotate-45 text-[#ef9472]" /><div className="text-right"><p className="text-2xl font-bold">{time(flight.arrivalTime)}</p><p className="mt-1 text-sm text-slate-200">{destination?.cityName || destination?.name || `Airport ${flight.arrivalAirportId}`} {airportCode(destination)}</p></div></div>
        <div className="mt-4 border-t border-white/15 pt-3 text-xs text-slate-300"><p>{origin?.name || 'Departure airport'}</p><p className="mt-1">→ {destination?.name || 'Arrival airport'}</p></div>
        <div className="mt-4 flex justify-between border-t border-white/15 pt-4 text-xs text-slate-300"><span>{flightDuration(flight)} · Direct</span><span>{flight.totalSeats} seats left</span></div>
      </div>
      {feedback ? <div className="mt-8 rounded-2xl border border-[#cfe9dd] bg-[#eff9f3] p-6"><CheckCircle2 size={30} className="text-[#328b69]" /><h3 className="mt-3 text-xl font-bold text-[#0c3a36]">{feedback.status === 'Booked' ? 'You’re booked!' : 'Booking in progress'}</h3><p className="mt-2 text-sm leading-6 text-[#4d6b64]">{feedback.status === 'Booked' ? 'Your seat is confirmed. If you added an email, your message will appear in Mailpit.' : 'The system is recovering this request. Open My journeys and retry with the same booking key to check its result.'}</p><p className="mt-4 text-xs font-semibold text-[#277050]">Booking #{feedback.id} · {feedback.status}</p><Button onClick={onTrips} variant="dark" className="mt-5 w-full">View my journeys <ArrowRight size={17} /></Button></div> : <form onSubmit={event => { event.preventDefault(); onBook({ flightId: flight.id, noOfSeats: Number(seats), notificationEmail: notificationEmail.trim() || null }); }} className="mt-8 space-y-5">
        <div className="grid grid-cols-2 gap-4"><Field label="Seats"><select className="input" value={seats} onChange={event => setSeats(Number(event.target.value))}>{Array.from({ length: Math.min(8, Number(flight.totalSeats) || 1) }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} {value === 1 ? 'seat' : 'seats'}</option>)}</select></Field><div className="rounded-xl bg-[#f0f6f7] px-4 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Total fare</p><p className="mt-1 text-xl font-bold text-[#0c3249]">{money(Number(flight.price) * seats)}</p></div></div>
        <Field label="Email confirmation (optional)"><div className="relative"><Mail size={17} className="absolute left-4 top-3.5 text-slate-400" /><input type="email" value={notificationEmail} onChange={event => setNotificationEmail(event.target.value)} className="input !pl-11" placeholder="you@example.com" /></div></Field>
        <p className="text-xs leading-5 text-slate-400">This local project does not charge a payment method. Reservations are checked against live MySQL inventory.</p>
        {error && <p role="alert" className="alert-error">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">Confirm booking <ArrowRight size={17} /></Button>
      </form>}
    </aside>
  </div>;
}

function Explore({ catalog, catalogError, onReloadCatalog, airportsById, onSelectFlight, onOperations }) {
  const [filters, setFilters] = useState(initialSearch);
  const [flights, setFlights] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('soonest');
  const [visible, setVisible] = useState(9);
  const allAirports = catalog?.airports || [];
  const codedAirports = allAirports.filter(airportCode);
  const airports = (codedAirports.length >= 2 ? codedAirports : allAirports)
    .slice().sort((a, b) => (a.cityName || a.name).localeCompare(b.cityName || b.name));
  const byCode = Object.fromEntries(codedAirports.map(airport => [airportCode(airport), airport]));
  const popularRoutes = [['DEL', 'BOM'], ['BOM', 'BLR'], ['BLR', 'HYD'], ['DEL', 'BLR']]
    .filter(([from, to]) => byCode[from] && byCode[to]);
  const update = (field, value) => setFilters(current => ({ ...current, [field]: value }));

  async function search(event) {
    event.preventDefault();
    if (!filters.departureAirportId || !filters.arrivalAirportId) { setError('Choose departure and arrival airports.'); return; }
    if (filters.departureAirportId === filters.arrivalAirportId) { setError('Choose two different airports.'); return; }
    setBusy(true); setError(''); setVisible(9);
    try {
      const query = Object.fromEntries(['departureAirportId', 'arrivalAirportId', 'minPrice', 'maxPrice'].filter(key => filters[key]).map(key => [key, filters[key]]));
      const response = await api.searchFlights(query);
      const all = Array.isArray(response.data) ? response.data : [];
      setFlights(filters.date ? all.filter(flight => localDateKey(flight.departureTime) === filters.date) : all);
      setSearched(true);
      requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const sortedFlights = useMemo(() => [...flights].sort((a, b) => sort === 'lowest' ? Number(a.price) - Number(b.price) : sort === 'seats' ? Number(b.totalSeats) - Number(a.totalSeats) : new Date(a.departureTime) - new Date(b.departureTime)), [flights, sort]);
  const options = airports.map(airport => <option key={airport.id} value={airport.id}>{airport.cityName ? `${airport.cityName} · ` : ''}{airport.name}</option>);

  return <>
    <section className="hero-shell"><div className="hero-grid container-xl">
      <div className="relative z-10 max-w-[650px] py-16 sm:py-20 lg:py-25"><span className="hero-pill"><Sparkles size={14} /> THE WORLD IS WAITING</span><h1 className="mt-7 font-display text-[clamp(3rem,6vw,5.4rem)] leading-[1.06] tracking-[-0.045em] text-white">A little more sky.<br /><span className="text-[#f5a884]">A lot more life.</span></h1><p className="mt-6 max-w-md text-base leading-7 text-[#c3d5de]">Discover your next destination and make every departure feel like the beginning of something wonderful.</p><div className="mt-9 flex flex-wrap items-center gap-6 text-sm text-[#e4eff1]"><span className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#9ddacc]" /> Live seat availability</span><span className="flex items-center gap-2"><CheckCircle2 size={17} className="text-[#9ddacc]" /> Simple booking</span></div></div>
      <div className="hero-visual" aria-hidden="true"><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><div className="hero-orbit hero-orbit-three" /><div className="hero-globe"><div className="hero-globe-line one" /><div className="hero-globe-line two" /><div className="hero-globe-line three" /></div><Plane className="hero-plane" size={112} strokeWidth={1.05} /><span className="hero-star star-one">✦</span><span className="hero-star star-two">✦</span><span className="hero-star star-three">✦</span></div>
    </div></section>

    <div className="container-xl relative z-20 -mt-8 sm:-mt-12"><form onSubmit={search} className="search-card"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">PLAN YOUR JOURNEY</p><h2 className="mt-1 text-xl font-bold text-[#092843]">Where to next?</h2></div><span className="hidden rounded-full bg-[#e9f5f3] px-3 py-1.5 text-xs font-semibold text-[#367766] sm:inline-flex">One way · Direct flights</span></div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_1fr_auto]"><Field label="From"><div className="relative"><PlaneTakeoff size={19} className="input-icon" /><select aria-label="Departure airport" required className="input !pl-11" value={filters.departureAirportId} onChange={event => update('departureAirportId', event.target.value)}><option value="">Choose airport</option>{options}</select></div></Field><button type="button" aria-label="Swap airports" onClick={() => setFilters(current => ({ ...current, departureAirportId: current.arrivalAirportId, arrivalAirportId: current.departureAirportId }))} className="mt-5 hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-[#416e81] transition hover:bg-[#eaf3f5] lg:flex"><ArrowLeftRight size={17} /></button><Field label="To"><div className="relative"><PlaneLanding size={19} className="input-icon" /><select aria-label="Arrival airport" required className="input !pl-11" value={filters.arrivalAirportId} onChange={event => update('arrivalAirportId', event.target.value)}><option value="">Choose airport</option>{options}</select></div></Field><Field label="Departure (optional)"><div className="relative"><CalendarDays size={18} className="input-icon" /><input aria-label="Departure date" type="date" className="input !pl-11" value={filters.date} onChange={event => update('date', event.target.value)} /></div></Field><Button type="submit" busy={busy} disabled={!airports.length} className="h-[50px] self-end whitespace-nowrap"><Search size={18} /> Search flights</Button></div>
      <details className="mt-5 border-t border-slate-100 pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-[#28637a]"><SlidersHorizontal size={15} /> Add a price range <ChevronDown size={14} /></summary><div className="mt-4 grid max-w-md grid-cols-2 gap-3"><Field label="Minimum fare"><input type="number" min="0" className="input" placeholder="₹ 0" value={filters.minPrice} onChange={event => update('minPrice', event.target.value)} /></Field><Field label="Maximum fare"><input type="number" min="0" className="input" placeholder="Any" value={filters.maxPrice} onChange={event => update('maxPrice', event.target.value)} /></Field></div></details>
      {popularRoutes.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-bold text-slate-500">Popular routes</span>{popularRoutes.map(([from, to]) => <button key={`${from}-${to}`} type="button" onClick={() => { setFilters(current => ({ ...current, departureAirportId: String(byCode[from].id), arrivalAirportId: String(byCode[to].id), date: '' })); setSearched(false); }} className="feature-chip hover:border-[#9ccbd3] hover:text-[#205e74]">{byCode[from].cityName} → {byCode[to].cityName}</button>)}</div>}
      {catalogError && <div role="alert" className="mt-4 flex items-center justify-between gap-3 text-sm text-rose-600"><span>{catalogError}</span><button type="button" onClick={onReloadCatalog} className="font-bold underline">Retry</button></div>}
      {error && <p role="alert" className="alert-error mt-4">{error}</p>}
    </form></div>

    <main className="container-xl pb-24 pt-16" id="results">
      {searched ? <><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">YOUR OPTIONS</p><h2 className="mt-2 font-display text-3xl text-[#0a2b44] sm:text-4xl">Flights worth looking forward to</h2><p className="mt-2 text-sm text-slate-500">{flights.length} {flights.length === 1 ? 'flight' : 'flights'} found for your route · Sample schedules and fares, not live airline bookings</p></div><select aria-label="Sort flights" value={sort} onChange={event => setSort(event.target.value)} className="input !w-auto !min-w-44"><option value="soonest">Earliest departure</option><option value="lowest">Lowest fare</option><option value="seats">Most seats</option></select></div>
        {flights.length ? <><div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">{sortedFlights.slice(0, visible).map(flight => <FlightCard key={flight.id} flight={flight} origin={airportsById[flight.departureAirportId]} destination={airportsById[flight.arrivalAirportId]} onSelect={() => onSelectFlight(flight)} />)}</div>{visible < flights.length && <div className="mt-9 text-center"><Button variant="outline" onClick={() => setVisible(value => value + 9)}>Show more flights <ArrowRight size={16} /></Button></div>}</> : <div className="empty-state"><Compass size={36} className="mx-auto text-[#6da4ae]" /><h3 className="mt-4 font-display text-3xl text-[#0c2e46]">No flights for this search</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Try another date, route, or price range. Flights can be added from the operator console.</p><Button onClick={onOperations} variant="soft" className="mt-6">Open operator console <ArrowRight size={16} /></Button></div>}</> : <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center"><div><p className="eyebrow">FLY WITH CONFIDENCE</p><h2 className="mt-3 font-display text-4xl leading-tight text-[#0b2a42]">The journey feels better<br />when it’s simple.</h2><p className="mt-5 max-w-xl leading-7 text-slate-500">Search live routes, compare times and fares, and reserve against real seat inventory. Your booking stays recoverable even when a service is briefly busy.</p><div className="mt-7 flex flex-wrap gap-3"><span className="feature-chip"><Search size={17} /> Find a route</span><span className="feature-chip"><Ticket size={17} /> Reserve seats</span><span className="feature-chip"><Mail size={17} /> Get the details</span></div></div><div className="journey-card"><div className="mb-7 flex items-center justify-between"><span className="text-xs font-bold tracking-[0.18em] text-[#2d7784]">YOUR BOARDING PASS</span><Plane size={22} className="-rotate-45 text-[#e78360]" /></div><p className="font-display text-3xl text-[#0d354a]">Good things are<br />taking off.</p><div className="my-7 border-t border-dashed border-[#b7d2d7]" /><div className="grid grid-cols-2 text-xs text-slate-500"><span>DESTINATION</span><span className="text-right">YOUR NEXT ADVENTURE</span></div></div></div>}
    </main>
  </>;
}

function Journeys({ journeys, session, onSignIn, onRetry, onCancel, busyId }) {
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  async function load(reset = true) {
    if (!session) return;
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const { data } = await api.bookings(session.token, reset ? undefined : nextCursor);
      if (version !== requestVersion.current) return;
      setRows(current => reset ? data.items : [...current, ...data.items.filter(row => !current.some(item => item.id === row.id))]);
      setNextCursor(data.nextCursor);
    } catch (failure) {
      if (version === requestVersion.current) setError(failure.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  useEffect(() => { load(); return () => { requestVersion.current++; }; }, []);

  const local = journeys.filter(item => (item.userId ?? item.body?.userId) === session?.id);
  const own = [...local.filter(item => !item.id), ...rows.map(row => {
    const saved = local.find(item => item.id === row.id);
    return { ...saved, ...row, key: saved?.key || `booking-${row.id}`, serverRecord: true,
      body: saved?.body || { flightId: row.flightId, noOfSeats: row.noOfSeats } };
  })];
  async function act(action, item) {
    const receipt = await action(item);
    if (!receipt) return;
    if (!item.id) { await load(); return; }
    setRows(current => current.map(row => row.id === receipt.id ? { ...row, ...receipt } : row));
  }

  return <main className="container-xl min-h-[68vh] py-16">
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">YOUR TRAVEL DESK</p><h1 className="mt-2 font-display text-5xl text-[#0b2a42]">My journeys</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Your account's bookings, newest first. Sign in again on any browser to see them.</p></div>
      {session && <Button variant="soft" busy={loading} disabled={Boolean(busyId)} onClick={() => load()}><RefreshCw size={16} /> Refresh</Button>}
    </div>
    {error && <p role="alert" className="alert-error mb-5">{error} Use Refresh to try again.</p>}
    {!session ? <div className="empty-state"><Ticket size={38} className="mx-auto text-[#6da4ae]" /><h2 className="mt-4 font-display text-3xl">Sign in to see your journeys</h2><Button onClick={onSignIn} className="mt-6">Sign in <ArrowRight size={17} /></Button></div>
      : !own.length ? <div className="empty-state"><Plane size={38} className="mx-auto -rotate-45 text-[#6da4ae]" /><h2 className="mt-4 font-display text-3xl">{loading ? 'Loading your bookings…' : error ? 'Bookings could not be loaded' : 'Your story starts with a flight'}</h2>{!loading && !error && <p className="mt-2 text-sm text-slate-500">Your bookings will appear here after you reserve a flight.</p>}</div>
      : <div className="grid gap-4 lg:grid-cols-2">{own.map(item => {
        const pendingCancellation = item.cancelRequested && !item.reservationReleased;
        return <article key={item.key} className="flight-card">
          <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{item.id ? `BOOKING #${item.id}` : 'AWAITING CONFIRMATION'}</p>
            <h3 className="mt-2 text-xl font-bold text-[#0b2a42]">{item.flight?.flightNumber || `Flight ${item.flightId ?? item.body.flightId}`}</h3>
            <p className="mt-1 text-sm text-slate-500">{item.flight?.departureTime ? date(item.flight.departureTime) : item.createdAt ? `Booked on ${date(item.createdAt)}` : 'Request awaiting a receipt'} · {item.body.noOfSeats} {item.body.noOfSeats === 1 ? 'seat' : 'seats'}</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === 'Booked' ? 'bg-[#e5f5ec] text-[#2c8766]' : item.status === 'Cancelled' && !pendingCancellation ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-800'}`}>{pendingCancellation ? 'Cancellation pending' : item.status}</span>
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4"><strong className="text-xl text-[#0b2a42]">{money(item.totalCost ?? Number(item.flight?.price) * item.body.noOfSeats)}</strong><div className="flex gap-2">
            {(item.status === 'InProcess' || pendingCancellation) && <Button variant="soft" disabled={loading} busy={busyId === item.key} onClick={() => act(onRetry, item)} className="!px-3 !py-2"><RefreshCw size={15} /> Check status</Button>}
            {item.status === 'Booked' && item.canCancel !== false && <Button variant="outline" disabled={loading} busy={busyId === item.key} onClick={() => act(onCancel, item)} className="!px-3 !py-2">Cancel booking</Button>}
          </div></div>
          {item.status === 'Booked' && item.canCancel === false && <p className="mt-3 text-xs text-slate-500">This older booking requires manual cancellation.</p>}
        </article>;
      })}</div>}
    {nextCursor && <div className="mt-8 text-center"><Button variant="outline" busy={loading} disabled={Boolean(busyId)} onClick={() => load(false)}>Load older bookings <ArrowRight size={16} /></Button></div>}
  </main>;
}

function Operations({ catalog, reloadCatalog, session, onSignIn, notify, airportsById }) {
  const [busy, setBusy] = useState('');
  const [cityName, setCityName] = useState('');
  const [airport, setAirport] = useState({ name: '', cityId: '' });
  const [airplane, setAirplane] = useState({ modelNumber: '', capacity: '' });
  const [flight, setFlight] = useState(initialFlight);
  const [editId, setEditId] = useState('');
  const [editFlight, setEditFlight] = useState(null);
  const [editFields, setEditFields] = useState({ price: '', boardingGate: '' });
  const [flightSuccess, setFlightSuccess] = useState(null);
  const [error, setError] = useState('');
  const run = async (name, action, success) => {
    setBusy(name); setError('');
    try { const result = await action(); await reloadCatalog(); notify(success); return result; }
    catch (failure) { setError(failure.message); return null; }
    finally { setBusy(''); }
  };
  const updateFlightField = (field, value) => setFlight(current => ({ ...current, [field]: value }));

  async function publish(event) {
    event.preventDefault();
    setFlightSuccess(null);
    if (flight.departureAirportId === flight.arrivalAirportId) { setError('Choose two different airports.'); return; }
    if (new Date(flight.arrivalTime) <= new Date(flight.departureTime)) { setError('Arrival must be after departure.'); return; }
    const body = { ...flight, airplaneId: Number(flight.airplaneId), departureAirportId: Number(flight.departureAirportId), arrivalAirportId: Number(flight.arrivalAirportId), price: Number(flight.price), departureTime: new Date(flight.departureTime).toISOString(), arrivalTime: new Date(flight.arrivalTime).toISOString() };
    const response = await run('flight', () => api.createFlight(body, session.token), 'Flight added successfully.');
    if (response) { setFlightSuccess({ number: response.data?.flightNumber || body.flightNumber, id: response.data?.id }); setEditId(String(response.data?.id || '')); setFlight(initialFlight); }
  }

  async function findFlight(event) {
    event.preventDefault(); setBusy('lookup'); setError('');
    try { const result = await api.flight(editId); if (!result.data) throw new Error('Flight not found.'); setEditFlight(result.data); setEditFields({ price: String(result.data.price), boardingGate: result.data.boardingGate || '' }); }
    catch (failure) { setEditFlight(null); setError(failure.message); }
    finally { setBusy(''); }
  }

  if (!session) return <main className="container-xl min-h-[68vh] py-16"><p className="eyebrow">LOCAL OPERATOR CONSOLE</p><h1 className="mt-2 font-display text-5xl text-[#0b2a42]">Manage the skies.</h1><div className="empty-state mt-10"><LayoutDashboard size={38} className="mx-auto text-[#6da4ae]" /><h2 className="mt-4 font-display text-3xl">Sign in to open the console</h2><p className="mt-2 text-sm text-slate-500">Use your admin account to manage cities, airports, aircraft, and flights.</p><Button onClick={onSignIn} className="mt-6">Sign in <ArrowRight size={16} /></Button></div></main>;

  if (!session.roles?.includes('ADMIN')) return <main className="container-xl min-h-[68vh] py-16"><p className="eyebrow">OPERATOR CONSOLE</p><h1 className="mt-2 font-display text-5xl text-[#0b2a42]">Admin access required</h1><p className="mt-4 text-slate-600">This account can search and book flights. Sign in with a local admin account to manage the catalog.</p></main>;

  return <main className="container-xl pb-24 pt-16"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">LOCAL OPERATOR CONSOLE</p><h1 className="mt-2 font-display text-5xl text-[#0b2a42]">Manage the skies.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Build the catalog, publish flights, and keep route information current.</p></div><span className="rounded-full bg-[#e7f3ee] px-4 py-2 text-xs font-bold text-[#28775c]">Connected to live catalog</span></div>
    <div className="mt-8 rounded-xl border border-[#cbe7d8] bg-[#e7f3ee] px-5 py-4 text-sm leading-6 text-[#28775c]">Admin access verified. You can add and update flights.</div>
    {error && <p role="alert" className="alert-error mt-5">{error}</p>}
    <div className="mt-8 grid gap-4 sm:grid-cols-3">{[['Cities', catalog?.cities?.length || 0, MapPin], ['Airports', catalog?.airports?.length || 0, Compass], ['Aircraft', catalog?.airplanes?.length || 0, Plane]].map(([label, value, Icon]) => <div key={label} className="stat-card"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f3f5] text-[#368094]"><Icon size={20} /></span><div><strong className="text-2xl text-[#092843]">{value}</strong><p className="text-xs font-semibold text-slate-500">{label} in catalog</p></div></div>)}</div>

    <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]"><section className="panel-card"><div className="section-title"><span className="step-number">01</span><div><p className="eyebrow">SCHEDULE</p><h2 className="text-2xl font-bold text-[#0b2a42]">Publish a flight</h2></div></div>{flightSuccess && <div role="status" aria-live="polite" className="mt-5 flex items-start gap-3 rounded-xl border border-[#cbe7d8] bg-[#e7f3ee] px-4 py-4 text-[#28775c]"><CheckCircle2 size={22} className="mt-0.5 shrink-0" /><div><p className="font-bold">Flight added successfully.</p><p className="mt-1 text-sm">{flightSuccess.number}{flightSuccess.id ? ` · Flight ID ${flightSuccess.id}` : ''}</p></div></div>}<form onSubmit={publish} className="mt-7 grid gap-4 sm:grid-cols-2"><Field label="Flight number"><input required className="input" placeholder="AV 204" value={flight.flightNumber} onChange={event => updateFlightField('flightNumber', event.target.value)} /></Field><Field label="Aircraft"><select required className="input" value={flight.airplaneId} onChange={event => updateFlightField('airplaneId', event.target.value)}><option value="">Choose aircraft</option>{catalog?.airplanes?.map(item => <option key={item.id} value={item.id}>{item.modelNumber} · {item.capacity} seats</option>)}</select></Field><Field label="Departure airport"><select required className="input" value={flight.departureAirportId} onChange={event => updateFlightField('departureAirportId', event.target.value)}><option value="">Choose airport</option>{catalog?.airports?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Arrival airport"><select required className="input" value={flight.arrivalAirportId} onChange={event => updateFlightField('arrivalAirportId', event.target.value)}><option value="">Choose airport</option>{catalog?.airports?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Departure time"><input required type="datetime-local" className="input" value={flight.departureTime} onChange={event => updateFlightField('departureTime', event.target.value)} /></Field><Field label="Arrival time"><input required type="datetime-local" className="input" value={flight.arrivalTime} onChange={event => updateFlightField('arrivalTime', event.target.value)} /></Field><Field label="Fare per seat (₹)"><input required min="1" type="number" className="input" placeholder="2500" value={flight.price} onChange={event => updateFlightField('price', event.target.value)} /></Field><div className="self-end"><Button type="submit" busy={busy === 'flight'} disabled={!catalog?.airplanes?.length || !catalog?.airports?.length} className="w-full"><Plus size={16} /> Publish flight</Button></div></form><p className="mt-4 text-xs text-slate-400">No aircraft or airports yet? Add them using the catalog tools alongside this form.</p></section>
      <div className="space-y-6"><section className="panel-card"><div className="section-title"><span className="step-number">02</span><div><p className="eyebrow">ROUTE BUILDING</p><h2 className="text-2xl font-bold text-[#0b2a42]">Add a city</h2></div></div><form onSubmit={async event => { event.preventDefault(); const result = await run('city', () => api.createCity(cityName.trim(), session.token), 'City added.'); if (result) setCityName(''); }} className="mt-6 flex gap-2"><input required className="input" placeholder="City name" value={cityName} onChange={event => setCityName(event.target.value)} /><Button type="submit" busy={busy === 'city'} className="!px-4"><Plus size={18} /></Button></form></section>
        <section className="panel-card"><div className="section-title"><span className="step-number">03</span><div><p className="eyebrow">ROUTE BUILDING</p><h2 className="text-2xl font-bold text-[#0b2a42]">Add an airport</h2></div></div><form onSubmit={async event => { event.preventDefault(); const result = await run('airport', () => api.createAirport({ name: airport.name.trim(), cityId: Number(airport.cityId) }, session.token), 'Airport added.'); if (result) setAirport({ name: '', cityId: '' }); }} className="mt-6 space-y-3"><input required className="input" placeholder="Airport name" value={airport.name} onChange={event => setAirport(current => ({ ...current, name: event.target.value }))} /><select required className="input" value={airport.cityId} onChange={event => setAirport(current => ({ ...current, cityId: event.target.value }))}><option value="">Choose city</option>{catalog?.cities?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="submit" busy={busy === 'airport'} disabled={!catalog?.cities?.length} variant="dark" className="w-full">Add airport <ArrowRight size={16} /></Button></form></section>
        <section className="panel-card"><div className="section-title"><span className="step-number">04</span><div><p className="eyebrow">FLEET</p><h2 className="text-2xl font-bold text-[#0b2a42]">Add aircraft</h2></div></div><form onSubmit={async event => { event.preventDefault(); const result = await run('airplane', () => api.createAirplane({ modelNumber: airplane.modelNumber.trim(), capacity: Number(airplane.capacity) }, session.token), 'Aircraft added.'); if (result) setAirplane({ modelNumber: '', capacity: '' }); }} className="mt-6 grid grid-cols-[1fr_110px] gap-3"><input required className="input" placeholder="Model, e.g. A320" value={airplane.modelNumber} onChange={event => setAirplane(current => ({ ...current, modelNumber: event.target.value }))} /><input required min="1" max="1000" type="number" className="input" placeholder="Seats" value={airplane.capacity} onChange={event => setAirplane(current => ({ ...current, capacity: event.target.value }))} /><Button type="submit" busy={busy === 'airplane'} variant="dark" className="col-span-2">Add aircraft <ArrowRight size={16} /></Button></form></section></div></div>

    <section className="panel-card mt-6"><div className="section-title"><span className="step-number">05</span><div><p className="eyebrow">FLIGHT CONTROL</p><h2 className="text-2xl font-bold text-[#0b2a42]">Update a flight</h2></div></div><p className="mt-3 text-sm text-slate-500">Look up a flight by ID, then update its fare or boarding gate. Seat inventory remains controlled by reservations.</p><form onSubmit={findFlight} className="mt-5 flex max-w-md gap-2"><input required type="number" min="1" className="input" placeholder="Flight ID" value={editId} onChange={event => setEditId(event.target.value)} /><Button type="submit" busy={busy === 'lookup'} variant="soft">Look up</Button></form>{editFlight && <form onSubmit={async event => { event.preventDefault(); const result = await run('update', () => api.updateFlight(editFlight.id, { price: Number(editFields.price), boardingGate: editFields.boardingGate.trim() }, session.token), 'Flight updated.'); if (result) { const fresh = await api.flight(editFlight.id); setEditFlight(fresh.data); } }} className="mt-5 grid max-w-xl gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2"><div className="sm:col-span-2 text-sm font-bold text-[#0b2a42]">{editFlight.flightNumber} · {airportsById[editFlight.departureAirportId]?.name || 'Departure'} to {airportsById[editFlight.arrivalAirportId]?.name || 'Arrival'}</div><Field label="Fare per seat (₹)"><input required type="number" min="1" className="input" value={editFields.price} onChange={event => setEditFields(current => ({ ...current, price: event.target.value }))} /></Field><Field label="Boarding gate"><input className="input" placeholder="A12" value={editFields.boardingGate} onChange={event => setEditFields(current => ({ ...current, boardingGate: event.target.value }))} /></Field><Button type="submit" busy={busy === 'update'} className="sm:col-span-2">Save changes <Check size={16} /></Button></form>}</section>
  </main>;
}

export default function App() {
  const [view, setView] = useState('explore');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [session, setSession] = useState(() => readStored(SESSION_KEY, null));
  const authVersion = useRef(0);
  const [journeys, setJourneys] = useState(() => readStored(JOURNEYS_KEY, []));
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingFeedback, setBookingFeedback] = useState(null);
  const [activeAttempt, setActiveAttempt] = useState(null);
  const [busyJourney, setBusyJourney] = useState('');
  const [toast, setToast] = useState('');

  async function reloadCatalog() {
    try {
      const response = await api.catalog();
      const cities = new Map((response.data?.cities || []).map(city => [city.id, city.name]));
      setCatalog({ ...response.data, airports: (response.data?.airports || []).map(airport => ({ ...airport, cityName: cities.get(airport.cityId) })) });
      setCatalogError('');
    } catch (error) { setCatalogError(error.message); }
  }
  useEffect(() => { reloadCatalog(); }, []);
  useEffect(() => {
    const version = ++authVersion.current;
    if (session) api.me(session.token).then(({ data }) => {
      if (version !== authVersion.current) return;
      const verified = { token: session.token, ...data };
      setSession(verified); sessionStorage.setItem(SESSION_KEY, JSON.stringify(verified));
    }).catch(() => {
      if (version !== authVersion.current) return;
      setSession(null); sessionStorage.removeItem(SESSION_KEY);
    });
    return () => { authVersion.current++; };
  }, []);
  useEffect(() => { sessionStorage.setItem(JOURNEYS_KEY, JSON.stringify(journeys)); }, [journeys]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  const airportsById = useMemo(() => Object.fromEntries((catalog?.airports || []).map(airport => [airport.id, airport])), [catalog]);
  const navigate = target => { setView(target); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const signedIn = value => { authVersion.current++; setSession(value); sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); setAuthOpen(false); setToast(`Welcome, ${value.email}`); };
  const signOut = () => {
    authVersion.current++;
    setSession(null); sessionStorage.removeItem(SESSION_KEY);
    setMobileOpen(false); setAuthOpen(false); setSelectedFlight(null);
    setActiveAttempt(null); setBookingFeedback(null); setBookingError('');
    setView('explore'); setToast('Logged out.');
  };
  const saveJourney = (receipt, attempt, flight) => setJourneys(current => [{ ...receipt, key: attempt.key, body: attempt.body, userId: receipt.userId ?? attempt.userId, flight, savedAt: Date.now() }, ...current.filter(item => item.key !== attempt.key)]);

  async function book(form) {
    if (!session) { setAuthOpen(true); return; }
    const attempt = (activeAttempt?.userId === session.id ? activeAttempt : null) || { key: crypto.randomUUID(), body: { ...form }, userId: session.id };
    setActiveAttempt(attempt); setBookingBusy(true); setBookingError('');
    try {
      const response = await api.book(attempt.body, attempt.key, session.token);
      setBookingFeedback(response.data);
      saveJourney(response.data, attempt, selectedFlight);
      setActiveAttempt(null);
    } catch (error) {
      if (error.status >= 400 && error.status < 500) {
        setActiveAttempt(null);
        setBookingError(error.message);
      } else {
        saveJourney({ status: 'InProcess' }, attempt, selectedFlight);
        setBookingError(`${error.message} This attempt is saved under My journeys; retry there with the same key before making another booking.`);
      }
    }
    finally { setBookingBusy(false); }
  }

  async function retryJourney(item) {
    setBusyJourney(item.key);
    try { const response = item.id ? await api.booking(item.id, session.token) : await api.book(item.body, item.key, session.token); saveJourney(response.data, item, item.flight); setToast(`Booking status: ${response.data.status}`); return response.data; }
    catch (error) { setToast(error.message); }
    finally { setBusyJourney(''); }
  }

  async function cancelJourney(item) {
    setBusyJourney(item.key);
    try { const response = await api.cancel(item.id, item.serverRecord ? undefined : item.key, session.token); saveJourney(response.data, item, item.flight); setToast(response.status === 202 ? 'Cancellation is being processed.' : 'Booking cancelled and seats released.'); return response.data; }
    catch (error) { setToast(error.message); }
    finally { setBusyJourney(''); }
  }

  function selectFlight(flight) { setSelectedFlight(flight); setBookingError(''); setBookingFeedback(null); setActiveAttempt(null); }
  const tabs = [['explore', 'Explore', Compass], ['journeys', 'My journeys', Ticket], ['operations', 'Admin tools', LayoutDashboard]];
  return <div className="min-h-screen bg-[#f6f8f8] text-[#12354a]">
    <header className="relative z-30 border-b border-[#e5edef] bg-white"><div className="container-xl flex h-20 items-center justify-between gap-6"><button onClick={() => navigate('explore')} className="flex items-center gap-2.5 text-left"><span className="brand-mark"><Plane size={21} strokeWidth={2.2} className="-rotate-45" /></span><span className="text-2xl font-extrabold tracking-[-0.065em] text-[#092843]">aeris<span className="text-[#e8774f]">.</span></span></button>
      <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">{tabs.map(([name, label]) => <button key={name} onClick={() => navigate(name)} className={`nav-link ${view === name ? 'nav-link-active' : ''}`}>{label}</button>)}</nav>
      <div className="flex shrink-0 items-center gap-2">{session ? <><div className="hidden max-w-[180px] text-right lg:block"><p className="truncate text-xs font-bold text-[#0d2f46]">{session.email}</p><p className="text-[11px] text-slate-400">Signed in</p></div><Button onClick={signOut} variant="outline" className="!px-3 !py-2.5"><LogOut size={16} /> Log out</Button></> : <Button onClick={() => setAuthOpen(true)} variant="dark" className="!px-3 !py-2.5">Sign in <ArrowUpRight size={15} /></Button>}<button onClick={() => setMobileOpen(value => !value)} aria-label="Open menu" className="icon-button md:hidden"><Menu size={21} /></button></div>
    </div>{mobileOpen && <nav aria-label="Mobile navigation" className="container-xl flex flex-col gap-1 border-t border-slate-100 py-3 md:hidden">{tabs.map(([name, label]) => <button key={name} onClick={() => navigate(name)} className={`rounded-lg px-4 py-2 text-left text-sm font-semibold ${view === name ? 'bg-[#edf5f6] text-[#17637a]' : 'text-slate-600'}`}>{label}</button>)}{session ? <><p className="truncate px-4 pt-3 text-xs text-slate-500">{session.email}</p><button onClick={signOut} className="flex items-center gap-2 rounded-lg px-4 py-2 text-left text-sm font-semibold text-[#17637a]"><LogOut size={16} /> Log out</button></> : <button onClick={() => { setAuthOpen(true); setMobileOpen(false); }} className="rounded-lg px-4 py-2 text-left text-sm font-semibold text-[#17637a]">Sign in</button>}</nav>}</header>
    {view === 'explore' && <Explore catalog={catalog} catalogError={catalogError} onReloadCatalog={reloadCatalog} airportsById={airportsById} onSelectFlight={selectFlight} onOperations={() => navigate('operations')} />}
    {view === 'journeys' && <Journeys key={session?.token || 'guest'} journeys={journeys} session={session} onSignIn={() => setAuthOpen(true)} onRetry={retryJourney} onCancel={cancelJourney} busyId={busyJourney} />}
    {view === 'operations' && <Operations catalog={catalog} reloadCatalog={reloadCatalog} session={session} onSignIn={() => setAuthOpen(true)} notify={setToast} airportsById={airportsById} />}
    <footer className="border-t border-[#e2eaec] bg-white"><div className="container-xl flex flex-col items-start justify-between gap-4 py-8 text-xs text-slate-500 sm:flex-row sm:items-center"><div className="flex items-center gap-2 font-extrabold text-[#0b2a42]"><Plane size={17} className="-rotate-45 text-[#e8774f]" /> aeris<span className="font-normal text-slate-400">· flight booking demo</span></div><span>Built on live flight, booking, Redis and RabbitMQ services · No payment processing</span></div></footer>
    {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSuccess={signedIn} />}
    {selectedFlight && <BookingPanel flight={selectedFlight} origin={airportsById[selectedFlight.departureAirportId]} destination={airportsById[selectedFlight.arrivalAirportId]} email={session?.email} onClose={() => setSelectedFlight(null)} onBook={book} busy={bookingBusy} error={bookingError} feedback={bookingFeedback} onTrips={() => { setSelectedFlight(null); navigate('journeys'); }} />}
    {toast && <div role="status" className="toast"><CheckCircle2 size={18} className="text-[#80d5aa]" /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss message"><X size={16} /></button></div>}
  </div>;
}
