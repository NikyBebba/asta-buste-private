'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Team = { id: string; name: string }
type Round = { id: string; player_name: string; status: string; round_number: number }
type Bid = { id: string; team_id: string; participation: string; commit_hash: string | null; revealed_total: number | null; revealed_player_given: string | null; revealed_purchase_price: number | null; revealed_extra_credits: number | null }

export default function AdminPage() {
  const { roomId } = useParams()
  const [roomCode, setRoomCode] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [bids, setBids] = useState<Bid[]>([])
  const [playerInput, setPlayerInput] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setRoomCode(localStorage.getItem('room_code') || '')
    loadTeams()
    loadCurrentRound()

    const teamsSub = supabase
      .channel('teams')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` }, loadTeams)
      .subscribe()

    const roundsSub = supabase
      .channel('rounds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_rounds', filter: `room_id=eq.${roomId}` }, loadCurrentRound)
      .subscribe()

    return () => {
      supabase.removeChannel(teamsSub)
      supabase.removeChannel(roundsSub)
    }
  }, [roomId])

  useEffect(() => {
    if (!currentRound) return
    loadBids()
    const bidsSub = supabase
      .channel('bids')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `round_id=eq.${currentRound.id}` }, loadBids)
      .subscribe()
    return () => { supabase.removeChannel(bidsSub) }
  }, [currentRound?.id])

  async function loadTeams() {
    const { data } = await supabase.from('teams').select().eq('room_id', roomId).order('joined_at')
    if (data) setTeams(data)
  }

  async function loadCurrentRound() {
    const { data } = await supabase
      .from('auction_rounds')
      .select()
      .eq('room_id', roomId)
      .order('round_number', { ascending: false })
      .limit(1)
      .single()
    if (data) setCurrentRound(data)
    else setCurrentRound(null)
  }

  async function loadBids() {
    if (!currentRound) return
    const { data } = await supabase.from('bids').select().eq('round_id', currentRound.id)
    if (data) setBids(data)
  }

  async function startRound() {
    if (!playerInput.trim()) return
    setLoading(true)
    const roundNumber = currentRound ? currentRound.round_number + 1 : 1
    const { data: round } = await supabase
      .from('auction_rounds')
      .insert({ room_id: roomId, player_name: playerInput.trim().toUpperCase(), status: 'open_for_participation', round_number: roundNumber })
      .select()
      .single()
    if (round) setCurrentRound(round)
    setPlayerInput('')
    setLoading(false)
  }

  async function closeRound() {
    if (!currentRound) return
    setLoading(true)
    await supabase.from('auction_rounds').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', currentRound.id)
    setLoading(false)
  }

  async function revealBids() {
    if (!currentRound) return
    setLoading(true)
    await supabase.from('auction_rounds').update({ status: 'revealed', revealed_at: new Date().toISOString() }).eq('id', currentRound.id)
    await loadBids()
    setLoading(false)
  }

  async function declareWinner() {
    if (!currentRound) return
    const validBids = bids.filter(b => b.participation === 'joined' && b.revealed_total !== null)
    if (validBids.length === 0) return
    const winner = validBids.reduce((a, b) => (b.revealed_total! > a.revealed_total! ? b : a))
    await supabase.from('history').insert({
      round_id: currentRound.id,
      room_id: roomId,
      player_name: currentRound.player_name,
      winning_team_id: winner.team_id,
      winning_amount: winner.revealed_total,
    })
    await supabase.from('auction_rounds').update({ status: 'winner_declared' }).eq('id', currentRound.id)
    await loadCurrentRound()
  }

  const participatingBids = bids.filter(b => b.participation === 'joined')
  const sealedBids = bids.filter(b => b.participation === 'joined' && b.commit_hash)
  const skippedBids = bids.filter(b => b.participation === 'skipped')
  const winner = currentRound?.status === 'revealed'
    ? bids.filter(b => b.revealed_total !== null).reduce<Bid | null>((a, b) => (!a || b.revealed_total! > a.revealed_total! ? b : a), null)
    : null

  return (
    <main className="min-h-screen bg-black text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">👑 Admin</h1>
        <span className="bg-gray-800 px-3 py-1 rounded-lg text-sm font-mono">{roomCode}</span>
      </div>

      {/* Squadre */}
      <div className="mb-6">
        <p className="text-gray-400 text-sm mb-2">Squadre ({teams.length}/10)</p>
        <div className="flex flex-wrap gap-2">
          {teams.map(t => (
            <span key={t.id} className="bg-gray-800 px-3 py-1 rounded-full text-sm">{t.name}</span>
          ))}
        </div>
      </div>

      {/* Nessun round attivo */}
      {!currentRound || currentRound.status === 'winner_declared' ? (
        <div className="flex flex-col gap-3">
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 uppercase"
            placeholder="Nome giocatore (es. LAUTARO)"
            value={playerInput}
            onChange={e => setPlayerInput(e.target.value)}
          />
          <button
            onClick={startRound}
            disabled={loading}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50"
          >
            🔴 Metti in asta
          </button>
        </div>
      ) : (
        <div>
          <div className="bg-gray-900 rounded-2xl p-4 mb-4 text-center">
            <p className="text-gray-400 text-xs mb-1">In asta</p>
            <p className="text-2xl font-bold">{currentRound.player_name}</p>
            <p className="text-gray-500 text-xs mt-1">{currentRound.status}</p>
          </div>

          {/* Stato offerte */}
          {currentRound.status === 'open_for_participation' && (
            <div className="mb-4">
              {teams.map(t => {
                const bid = bids.find(b => b.team_id === t.id)
                return (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-800">
                    <span>{t.name}</span>
                    {!bid || bid.participation === 'pending' ? <span className="text-gray-500 text-sm">⏳ in attesa</span>
                      : bid.participation === 'skipped' ? <span className="text-gray-500 text-sm">⚪ salta</span>
                      : bid.commit_hash ? <span className="text-green-400 text-sm">🟢 sigillata</span>
                      : <span className="text-yellow-400 text-sm">🟡 partecipa</span>}
                  </div>
                )
              })}
              <button
                onClick={closeRound}
                disabled={loading}
                className="w-full mt-4 bg-red-600 text-white font-bold py-4 rounded-xl text-lg disabled:opacity-50"
              >
                🔒 Chiudi turno
              </button>
            </div>
          )}

          {currentRound.status === 'closed' && (
            <button
              onClick={revealBids}
              disabled={loading}
              className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50"
            >
              🔓 Apri offerte
            </button>
          )}

          {currentRound.status === 'revealed' && (
            <div>
              <div className="mb-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-800">
                      <th className="text-left py-2">Squadra</th>
                      <th className="text-left py-2">Ceduto</th>
                      <th className="text-right py-2">Offerta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bids.filter(b => b.participation === 'joined').sort((a, b) => (b.revealed_total || 0) - (a.revealed_total || 0)).map(bid => {
                      const team = teams.find(t => t.id === bid.team_id)
                      const isWinner = bid === winner
                      return (
                        <tr key={bid.id} className={`border-b border-gray-800 ${isWinner ? 'text-yellow-400 font-bold' : ''}`}>
                          <td className="py-2">{isWinner ? '🏆 ' : ''}{team?.name}</td>
                          <td className="py-2">{bid.revealed_player_given} ({bid.revealed_purchase_price})</td>
                          <td className="py-2 text-right">{bid.revealed_total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button
                onClick={declareWinner}
                className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl text-lg"
              >
                ✅ Conferma vincitore e prossimo giocatore
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}