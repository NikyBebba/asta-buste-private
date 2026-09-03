'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'choose' | 'admin_auth' | 'admin_config' | 'join'>('choose')
  
  // Configurazione Admin
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [sessionName, setSessionName] = useState('Asta Iniziale 2026/27')
  const [creationMode, setCreationMode] = useState<'preset' | 'free'>('preset')

  // Accesso Partecipante
  const [joinCode, setJoinCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [availableTeams, setAvailableTeams] = useState<string[]>([])
  const [roomData, setRoomData] = useState<any>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

    // Password corretta: passa alla configurazione della sessione
    setMode('admin_config')
  }

  // 2. Crea la Stanza con i Dati della Sessione
  async function createRoom() {
    if (!sessionName.trim()) return
    setLoading(true)
    setError('')

    try {
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

  // 3. Cerca Stanza per Partecipante
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

  // 4. Entra nella Stanza
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
            👑 Crea stanza (Admin)
          </button>
          <button
            onClick={() => { setMode('join'); setError(''); }}
            className="border border-white text-white font-bold py-4 rounded-xl text-lg active:scale-95 transition-transform select-none touch-manipulation"
          >
            🚪 Entra in una stanza
          </button>
        </div>
      )}

      {/* LOGIN ADMIN (PASSWORD) */}
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

      {/* CONFIGURAZIONE SESSIONE ADMIN */}
      {mode === 'admin_config' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <h2 className="text-xl font-bold text-center">Configura Nuova Sessione</h2>
          
          <div>
            <label className="text-xs text-gray-400 block mb-1">Nome della Sessione:</label>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
              placeholder="es. Asta Estiva 2026/27"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
            />
          </div>

          <div className="bg-gray-900 p-3 rounded-xl border border-gray-800 text-center">
            <label className="text-[10px] text-gray-400 block mb-1.5 font-semibold uppercase tracking-wider">Modalità Lega</label>
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

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            onClick={createRoom}
            disabled={loading || !sessionName.trim()}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
          >
            {loading ? 'Avvio...' : '🚀 Avvia Sessione Asta'}
          </button>
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
                <span className="text-xs text-gray-400 block uppercase font-mono">
                  {roomData.session_name || 'Stanza Trovata'}
                </span>
                <span className="text-lg font-bold text-blue-400">{roomData.code}</span>
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