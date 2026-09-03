'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'choose' | 'admin_auth' | 'admin_config' | 'join'>('choose')
  
  // Modalità Admin: 'create' per nuova sessione, 'history' per consultare il passato
  const [adminAction, setAdminAction] = useState<'create' | 'history'>('create')

  // Configurazione Nuova Sessione Admin
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [leagueName, setLeagueName] = useState('FantaPandy')
  const [sessionName, setSessionName] = useState('')
  const [creationMode, setCreationMode] = useState<'preset' | 'free'>('preset')

  // Consultazione Storico Admin
  const [existingLeagues, setExistingLeagues] = useState<string[]>([])
  const [selectedLeagueForHistory, setSelectedLeagueForHistory] = useState<string>('FantaPandy')
  const [pastSessions, setPastSessions] = useState<any[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')

  // Accesso Partecipante
  const [joinCode, setJoinCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [availableTeams, setAvailableTeams] = useState<string[]>([])
  const [roomData, setRoomData] = useState<any>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Carica le leghe e le sessioni esistenti per lo storico
  useEffect(() => {
    if (mode === 'admin_config' && adminAction === 'history') {
      loadPastSessions()
    }
  }, [mode, adminAction, selectedLeagueForHistory])

  async function loadPastSessions() {
    setLoading(true)
    try {
      // Recupera tutte le leghe distinte
      const { data: rooms } = await supabase.from('rooms').select('id, league_name, session_name, code')
      
      if (rooms) {
        const leagues = Array.from(new Set(rooms.map(r => r.league_name || 'FantaPandy')))
        setExistingLeagues(leagues)

        // Filtra le sessioni della lega selezionata
        const filtered = rooms.filter(r => (r.league_name || 'FantaPandy') === selectedLeagueForHistory)
        setPastSessions(filtered)

        if (filtered.length > 0) {
          setSelectedSessionId(filtered[0].id)
        } else {
          setSelectedSessionId('')
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // 1. Verifica Password Master Admin
  async function verifyAdminPassword() {
    setError('')
    setLoading(true)

    const { data: presetRoom, error: fetchError } = await supabase
      .from('rooms')
      .select('admin_password')
      .eq('code', 'PANDY2026')
      .single()

    setLoading(false)

    if (fetchError || !presetRoom) {
      setError('Errore nel recupero della configurazione Admin')
      return
    }

    if (adminPasswordInput !== presetRoom.admin_password) {
      setError('Password errata!')
      return
    }

    setMode('admin_config')
  }

  // 2. Crea la Stanza con Lega e Sessione
  async function createRoom() {
    if (!leagueName.trim() || !sessionName.trim()) return
    setLoading(true)
    setError('')

    try {
      // Controllo duplicato
      const { data: existingSession } = await supabase
        .from('rooms')
        .select('id')
        .eq('league_name', leagueName.trim())
        .ilike('session_name', sessionName.trim())
        .maybeSingle()

      if (existingSession) {
        setError(`Esiste già un'asta chiamata "${sessionName.trim()}" per la lega ${leagueName.trim()}!`)
        setLoading(false)
        return
      }

      let teamsToUpload: string[] = []

      if (creationMode === 'preset') {
        const { data: presetRoom } = await supabase
          .from('rooms')
          .select('available_teams')
          .eq('code', 'PANDY2026')
          .single()

        teamsToUpload = presetRoom?.available_teams || []
      }

      const code = Math.random().toString(36).substring(2, 8).toUpperCase()

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({ 
          code, 
          status: 'waiting',
          mode: creationMode,
          league_name: leagueName.trim(),
          session_name: sessionName.trim(),
          available_teams: teamsToUpload,
          admin_password: adminPasswordInput
        })
        .select()
        .single()

      if (roomError || !room) throw new Error('Errore nella creazione della stanza')

      localStorage.setItem('room_id', room.id)
      localStorage.setItem('room_code', room.code)
      localStorage.setItem('admin_token', room.admin_token)
      localStorage.setItem('is_admin', 'true')

      router.push(`/admin/${room.id}`)
    } catch (err: any) {
      setError(err.message || 'Errore imprevisto')
      setLoading(false)
    }
  }

  // 3. Accedi a una Sessione Passata
  function enterPastSession() {
    if (!selectedSessionId) return
    const targetRoom = pastSessions.find(s => s.id === selectedSessionId)
    if (!targetRoom) return

    localStorage.setItem('room_id', targetRoom.id)
    localStorage.setItem('room_code', targetRoom.code)
    localStorage.setItem('is_admin', 'true')

    router.push(`/admin/${targetRoom.id}`)
  }

  // 4. Cerca Stanza per Partecipante
  async function checkRoomCode() {
    if (!joinCode.trim()) return
    setLoading(true)
    setError('')

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select()
      .eq('code', joinCode.trim().toUpperCase())
      .single()

    if (roomError || !room) {
      setError('Stanza non trovata')
      setLoading(false)
      return
    }

    const { data: takenTeams } = await supabase
      .from('teams')
      .select('name')
      .eq('room_id', room.id)

    const takenNames = takenTeams?.map(t => t.name) || []

    if (room.mode === 'preset' && room.available_teams) {
      const remaining = (room.available_teams as string[]).filter(
        name => !takenNames.includes(name)
      )
      setAvailableTeams(remaining)
      if (remaining.length > 0) setTeamName(remaining[0])
    }

    setRoomData(room)
    setLoading(false)
  }

  // 5. Entra nella Stanza
  async function joinRoom() {
    if (!teamName.trim() || !roomData) return
    setLoading(true)
    setError('')

    const { count } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomData.id)

    if (count !== null && count >= 10) {
      setError('Stanza piena (10/10)')
      setLoading(false)
      return
    }

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ room_id: roomData.id, name: teamName.trim() })
      .select()
      .single()

    if (teamError) {
      setError('Nome già occupato o errore di connessione')
      setLoading(false)
      return
    }

    localStorage.setItem('team_id', team.id)
    localStorage.setItem('team_name', team.name)
    localStorage.setItem('room_id', roomData.id)
    localStorage.setItem('room_code', roomData.code)
    localStorage.setItem('is_admin', 'false')

    router.push(`/room/${roomData.id}`)
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 font-sans">
      <h1 className="text-3xl font-bold mb-2">🏆 Asta Buste Private</h1>
      <p className="text-gray-400 mb-10 text-sm">FantaPandy — sistema commit-reveal "CRETINY"</p>

      {/* SCHERMATA INIZIALE */}
      {mode === 'choose' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button
            onClick={() => { setMode('admin_auth'); setError(''); }}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg active:scale-95 transition-transform select-none touch-manipulation"
          >
            👑 Crea o Gestisci Stanza (Admin)
          </button>
          <button
            onClick={() => { setMode('join'); setError(''); }}
            className="border border-white text-white font-bold py-4 rounded-xl text-lg active:scale-95 transition-transform select-none touch-manipulation"
          >
            🚪 Entra in una stanza
          </button>
        </div>
      )}

      {/* LOGIN ADMIN */}
      {mode === 'admin_auth' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <h2 className="text-xl font-bold text-center">Area Riservata Admin</h2>
          <input
            type="password"
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
            placeholder="Password Master Admin"
            value={adminPasswordInput}
            onChange={e => setAdminPasswordInput(e.target.value)}
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={verifyAdminPassword}
            disabled={loading || !adminPasswordInput.trim()}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
          >
            {loading ? 'Verifica...' : 'Accedi'}
          </button>
          <button onClick={() => { setMode('choose'); setError(''); }} className="text-gray-500 text-sm text-center">
            ← Indietro
          </button>
        </div>
      )}

      {/* CONFIGURAZIONE / STORICO ADMIN */}
      {mode === 'admin_config' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          {/* SELETTORE AZIONE ADMIN */}
          <div className="flex bg-gray-900 p-1 rounded-xl border border-gray-800">
            <button
              onClick={() => setAdminAction('create')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                adminAction === 'create' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              ➕ Nuova Asta
            </button>
            <button
              onClick={() => setAdminAction('history')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                adminAction === 'history' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              📜 Storico Aste
            </button>
          </div>

          {/* SCHERMATA: CREA NUOVA SESSIONE */}
          {adminAction === 'create' && (
            <>
              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold uppercase">Nome Lega:</label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white font-semibold"
                  placeholder="es. FantaPandy"
                  value={leagueName}
                  onChange={e => setLeagueName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold uppercase">Nome Sessione / Asta:</label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
                  placeholder="es. Asta Estiva 2026/27"
                  value={sessionName}
                  onChange={e => setSessionName(e.target.value)}
                />
              </div>

              <div className="bg-gray-900 p-3 rounded-xl border border-gray-800 text-center">
                <label className="text-[10px] text-gray-400 block mb-1.5 font-semibold uppercase tracking-wider">Modalità Squadre</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreationMode('preset')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                      creationMode === 'preset' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    🏆 FantaPandy (10)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreationMode('free')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                      creationMode === 'free' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    ⚙️ Libera
                  </button>
                </div>
              </div>

              <button
                onClick={createRoom}
                disabled={loading || !leagueName.trim() || !sessionName.trim()}
                className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
              >
                {loading ? 'Avvio...' : '🚀 Avvia Nuova Sessione'}
              </button>
            </>
          )}

          {/* SCHERMATA: CONSULTA STORICO */}
          {adminAction === 'history' && (
            <>
              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold uppercase">Seleziona Lega:</label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white font-semibold"
                  value={selectedLeagueForHistory}
                  onChange={e => setSelectedLeagueForHistory(e.target.value)}
                >
                  {existingLeagues.length > 0 ? (
                    existingLeagues.map(l => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))
                  ) : (
                    <option value="FantaPandy">FantaPandy</option>
                  )}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold uppercase">Seleziona Asta Passata:</label>
                {pastSessions.length > 0 ? (
                  <select
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white font-semibold"
                    value={selectedSessionId}
                    onChange={e => setSelectedSessionId(e.target.value)}
                  >
                    {pastSessions.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.session_name || 'Asta Senza Nome'} ({s.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-gray-500 text-xs italic text-center py-2">Nessuna asta trovata per questa lega.</p>
                )}
              </div>

              <button
                onClick={enterPastSession}
                disabled={loading || !selectedSessionId}
                className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
              >
                📂 Entra nella Sessione
              </button>
            </>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>
      )}

      {/* ACCESSO GIOCATORE */}
      {mode === 'join' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          {!roomData ? (
            <>
              <input
                className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 uppercase font-mono tracking-wider"
                placeholder="Codice stanza"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
              />
              <button
                onClick={checkRoomCode}
                disabled={loading || !joinCode.trim()}
                className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
              >
                {loading ? 'Verifica...' : 'Trova Stanza'}
              </button>
            </>
          ) : (
            <>
              <div className="bg-gray-900 p-3 rounded-xl border border-gray-800 text-center mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-widest block">
                  {roomData.league_name || 'Lega'}
                </span>
                <span className="text-xs text-blue-400 block font-semibold mb-1">
                  {roomData.session_name || 'Sessione Asta'}
                </span>
                <span className="text-xl font-bold font-mono text-white">{roomData.code}</span>
              </div>

              {roomData.mode === 'preset' ? (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Seleziona la tua Squadra:</label>
                  {availableTeams.length > 0 ? (
                    <select
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white font-semibold"
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                    >
                      {availableTeams.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-amber-400 text-sm text-center">Tutte le squadre sono già state scelte!</p>
                  )}
                </div>
              ) : (
                <input
                  className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
                  placeholder="Nome della tua squadra"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                />
              )}

              <button
                onClick={joinRoom}
                disabled={loading || !teamName.trim() || (roomData.mode === 'preset' && availableTeams.length === 0)}
                className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
              >
                {loading ? 'Accesso...' : 'Entra'}
              </button>
            </>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button 
            onClick={() => { 
              setMode('choose'); 
              setRoomData(null); 
              setError(''); 
              setJoinCode('');
            }} 
            className="text-gray-500 text-sm mt-2 text-center"
          >
            ← Indietro
          </button>
        </div>
      )}
    </main>
  )
}