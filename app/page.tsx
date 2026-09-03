'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'choose' | 'join'>('choose')
  const [teamName, setTeamName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 1. Crea la Stanza come Admin (Banditore neutrale - Senza creare squadra)
  async function createRoom() {
    setLoading(true)
    setError('')

    const code = Math.random().toString(36).substring(2, 8).toUpperCase()

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({ code, status: 'waiting' })
      .select()
      .single()

    if (roomError || !room) {
      setError('Errore nella creazione della stanza')
      setLoading(false)
      return
    }

    // Salva i dati locali dell'Admin
    localStorage.setItem('room_id', room.id)
    localStorage.setItem('room_code', room.code)
    localStorage.setItem('admin_token', room.admin_token)
    localStorage.setItem('is_admin', 'true')

    // Vai al pannello Admin
    router.push(`/admin/${room.id}`)
  }

  // 2. Entra come Squadra Partecipante
  async function joinRoom() {
    if (!teamName.trim() || !joinCode.trim()) return
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

    // Controllo limite 10 squadre
    const { count } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)

    if (count !== null && count >= 10) {
      setError('Stanza piena (10/10)')
      setLoading(false)
      return
    }

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ room_id: room.id, name: teamName.trim() })
      .select()
      .single()

    if (teamError) {
      setError('Nome già in uso in questa stanza')
      setLoading(false)
      return
    }

    localStorage.setItem('team_id', team.id)
    localStorage.setItem('team_name', team.name)
    localStorage.setItem('room_id', room.id)
    localStorage.setItem('room_code', room.code)
    localStorage.setItem('is_admin', 'false')

    router.push(`/room/${room.id}`)
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 font-sans">
      <h1 className="text-3xl font-bold mb-2">🏆 Asta Buste Private</h1>
      <p className="text-gray-400 mb-10 text-sm">Fantacalcio — sistema commit-reveal</p>

      {mode === 'choose' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button
            onClick={createRoom}
            disabled={loading}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50"
          >
            {loading ? 'Creazione...' : '👑 Crea stanza (Admin)'}
          </button>
          <button
            onClick={() => setMode('join')}
            className="border border-white text-white font-bold py-4 rounded-xl text-lg"
          >
            🚪 Entra in una stanza
          </button>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>
      )}

      {mode === 'join' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
            placeholder="Nome della tua squadra"
            value={teamName}
            onChange={e => setTeamName(e.target.value)}
          />
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 uppercase font-mono tracking-wider"
            placeholder="Codice stanza"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={joinRoom}
            disabled={loading || !teamName.trim() || !joinCode.trim()}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50"
          >
            {loading ? 'Accesso...' : 'Entra'}
          </button>
          <button onClick={() => { setMode('choose'); setError(''); }} className="text-gray-500 text-sm">
            ← indietro
          </button>
        </div>
      )}
    </main>
  )
}