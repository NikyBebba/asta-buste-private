'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Team = { id: string; name: string }
type Round = { id: string; player_name: string; status: string; round_number: number }
type Bid = { 
  id: string; 
  team_id: string; 
  participation: string; 
  commit_hash: string | null; 
  revealed_total: number | null; 
  revealed_player_given: string | null; 
  revealed_purchase_price: number | null; 
  revealed_extra_credits: number | null 
}
type HistoryItem = {
  id: string;
  round_id: string;
  player_name: string;
  winning_team_id: string;
  winning_amount: number;
  teams: { name: string } | null;
}

export default function AdminPage() {
  const { roomId } = useParams()
  const router = useRouter()
  const [roomCode, setRoomCode] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [bids, setBids] = useState<Bid[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyBids, setHistoryBids] = useState<Record<string, Bid[]>>({})
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)
  const [playerInput, setPlayerInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [manualWinner, setManualWinner] = useState<Bid | null>(null)

  useEffect(() => {
    setRoomCode(localStorage.getItem('room_code') || '')
    loadTeams()
    loadCurrentRound()
    loadHistory()

    const teamsSub = supabase
      .channel('admin-teams')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` }, loadTeams)
      .subscribe()

    const roundsSub = supabase
      .channel('admin-rounds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_rounds', filter: `room_id=eq.${roomId}` }, loadCurrentRound)
      .subscribe()

    const historySub = supabase
      .channel('admin-history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history', filter: `room_id=eq.${roomId}` }, loadHistory)
      .subscribe()

    return () => {
      supabase.removeChannel(teamsSub)
      supabase.removeChannel(roundsSub)
      supabase.removeChannel(historySub)
    }
  }, [roomId])

  useEffect(() => {
    if (!currentRound) return
    loadBids()
    setManualWinner(null)
    const bidsSub = supabase
      .channel('admin-bids')
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

  async function loadHistory() {
    const { data } = await supabase
      .from('history')
      .select('id, round_id, player_name, winning_amount, winning_team_id, teams(name)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })

    if (data) setHistory(data as unknown as HistoryItem[])
  }

  async function toggleHistoryBids(roundId: string, historyId: string) {
    if (expandedHistoryId === historyId) {
      setExpandedHistoryId(null)
      return
    }
    const { data } = await supabase.from('bids').select().eq('round_id', roundId)
    if (data) {
      setHistoryBids(prev => ({ ...prev, [historyId]: data }))
      setExpandedHistoryId(historyId)
    }
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
    const targetWinner = manualWinner || autoWinner

    if (!targetWinner) {
      if (confirm("Nessuna offerta valida selezionata. Chiudere come INVENDUTO?")) {
        await skipUnsoldRound()
      }
      return
    }

    setLoading(true)

    await supabase.from('history').insert({
      round_id: currentRound.id,
      room_id: roomId,
      player_name: currentRound.player_name,
      winning_team_id: targetWinner.team_id,
      winning_amount: targetWinner.revealed_total,
    })

    await supabase.from('auction_rounds').update({ status: 'winner_declared' }).eq('id', currentRound.id)
    await loadCurrentRound()
    await loadHistory()
    setLoading(false)
  }

  async function skipUnsoldRound() {
    if (!currentRound) return
    setLoading(true)
    await supabase.from('auction_rounds').update({ status: 'winner_declared' }).eq('id', currentRound.id)
    await loadCurrentRound()
    setLoading(false)
  }

  async function deleteHistoryItem(historyId: string) {
    if (!confirm("Sei sicuro di voler annullare questa aggiudicazione?")) return
    setLoading(true)
    await supabase.from('history').delete().eq('id', historyId)
    await loadHistory()
    setLoading(false)
  }

  async function changeWinnerTeam(historyId: string, newTeamId: string) {
    setLoading(true)
    await supabase.from('history').update({ winning_team_id: newTeamId }).eq('id', historyId)
    await loadHistory()
    setLoading(false)
  }

  // --- LOGICA DI TIE-BREAK PARI TOTALE E PARI EXTRA ---
  const validBids = bids.filter(b => b.participation === 'joined' && b.revealed_total !== null && b.revealed_total !== undefined)
  
  const sortedBids = [...validBids].sort((a, b) => {
    const totA = a.revealed_total ?? 0
    const totB = b.revealed_total ?? 0
    if (totB !== totA) return totB - totA

    const extraA = a.revealed_extra_credits ?? 0
    const extraB = b.revealed_extra_credits ?? 0
    return extraB - extraA
  })

  const isPerfectTie = sortedBids.length > 1 && 
    sortedBids[0].revealed_total === sortedBids[1].revealed_total && 
    sortedBids[0].revealed_extra_credits === sortedBids[1].revealed_extra_credits

  const autoWinner = !isPerfectTie && sortedBids.length > 0 ? sortedBids[0] : null
  const activeWinner = manualWinner || autoWinner

  return (
    <main className="min-h-screen bg-black text-white p-4 max-w-lg mx-auto font-sans pb-16">
      {/* HEADER ADMIN CON TASTO INDIETRO DASHBOARD */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">👑 Admin / Banditore</h1>
          <span className="bg-gray-800 px-3 py-1 rounded-lg text-sm font-mono text-gray-300">{roomCode}</span>
        </div>
        <button 
          onClick={() => router.push('/')} 
          className="bg-gray-900 border border-gray-700 text-xs px-3 py-2 rounded-xl text-gray-300 hover:text-white active:scale-95 transition-transform"
        >
          ← Dashboard Home
        </button>
      </div>

      {/* Squadre */}
      <div className="mb-6">
        <p className="text-gray-400 text-sm mb-2">Squadre collegate ({teams.length}/10)</p>
        <div className="flex flex-wrap gap-2">
          {teams.map(t => (
            <span key={t.id} className="bg-gray-800 border border-gray-700 px-3 py-1 rounded-full text-xs">{t.name}</span>
          ))}
        </div>
      </div>

      {/* Controlli Asta */}
      {!currentRound || currentRound.status === 'winner_declared' ? (
        <div className="flex flex-col gap-3 mb-8">
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 uppercase"
            placeholder="Nome giocatore (es. LAUTARO)"
            value={playerInput}
            onChange={e => setPlayerInput(e.target.value)}
          />
          <button
            onClick={startRound}
            disabled={loading || !playerInput.trim()}
            className="bg-white text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
          >
            🔴 Metti in asta
          </button>
        </div>
      ) : (
        <div className="mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 text-center">
            <p className="text-gray-400 text-xs mb-1">In asta</p>
            <p className="text-2xl font-bold">{currentRound.player_name}</p>
            <span className="inline-block mt-2 bg-gray-800 text-yellow-400 px-3 py-1 rounded-full text-xs font-mono uppercase">
              {currentRound.status}
            </span>
          </div>

          {currentRound.status === 'open_for_participation' && (
            <div className="mb-4">
              <div className="flex flex-col gap-1 mb-4">
                {teams.map(t => {
                  const bid = bids.find(b => b.team_id === t.id)
                  return (
                    <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-800 text-sm">
                      <span>{t.name}</span>
                      {!bid || bid.participation === 'pending' ? <span className="text-gray-500">⏳ in attesa</span>
                        : bid.participation === 'skipped' ? <span className="text-gray-500">⚪ salta</span>
                        : bid.commit_hash ? <span className="text-green-400 font-bold">🟢 sigillata</span>
                        : <span className="text-yellow-400">🟡 partecipa</span>}
                    </div>
                  )
                })}
              </div>
              <button 
                onClick={closeRound} 
                disabled={loading} 
                className="w-full bg-red-600 font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
              >
                🔒 Chiudi turno
              </button>
            </div>
          )}

          {currentRound.status === 'closed' && (
            <button 
              onClick={revealBids} 
              disabled={loading} 
              className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
            >
              🔓 Apri offerte
            </button>
          )}

          {currentRound.status === 'revealed' && (
            <div>
              {/* PAREGGIO ASSOLUTO: MODULO ASSEGNAZIONE MANUALE ADMIN */}
              {isPerfectTie && !manualWinner && (
                <div className="bg-amber-950/40 border border-amber-500 p-4 rounded-xl mb-4 text-xs text-center">
                  <p className="text-amber-400 font-bold text-sm mb-1">⚠️ Pareggio Perfetto Rilevato!</p>
                  <p className="text-gray-300 mb-3">
                    Stesso totale ({sortedBids[0].revealed_total} cr) e stessi crediti extra ({sortedBids[0].revealed_extra_credits ?? 0} cr). Seleziona il vincitore:
                  </p>
                  <div className="flex flex-col gap-2">
                    {sortedBids.filter(b => 
                      b.revealed_total === sortedBids[0].revealed_total && 
                      b.revealed_extra_credits === sortedBids[0].revealed_extra_credits
                    ).map(b => {
                      const tName = teams.find(t => t.id === b.team_id)?.name
                      return (
                        <button
                          key={b.id}
                          onClick={() => setManualWinner(b)}
                          className="bg-amber-500 text-black font-bold py-2 px-3 rounded-lg hover:bg-amber-400 transition"
                        >
                          Assegna a {tName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {manualWinner && (
                <div className="bg-green-950/40 border border-green-500 p-3 rounded-xl mb-4 text-xs text-center flex justify-between items-center">
                  <span className="text-green-400 font-bold">
                    Scelta Manuale: {teams.find(t => t.id === manualWinner.team_id)?.name}
                  </span>
                  <button 
                    onClick={() => setManualWinner(null)}
                    className="text-gray-400 underline text-[10px]"
                  >
                    Cambia
                  </button>
                </div>
              )}

              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-2">Squadra</th>
                    <th className="text-left py-2">Ceduto</th>
                    <th className="text-right py-2 font-mono">Extra</th>
                    <th className="text-right py-2">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBids.map(bid => {
                    const team = teams.find(t => t.id === bid.team_id)
                    const isWinner = activeWinner && bid.id === activeWinner.id
                    return (
                      <tr key={bid.id} className={`border-b border-gray-800 ${isWinner ? 'text-yellow-400 font-bold' : ''}`}>
                        <td className="py-2">{isWinner ? '🏆 ' : ''}{team?.name}</td>
                        <td className="py-2">{bid.revealed_player_given ? `${bid.revealed_player_given} (${bid.revealed_purchase_price})` : '—'}</td>
                        <td className="py-2 text-right text-gray-400 text-xs font-mono">+{bid.revealed_extra_credits ?? 0}</td>
                        <td className="py-2 text-right">{bid.revealed_total !== null ? `${bid.revealed_total} cr` : 'In attesa...'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <button 
                onClick={declareWinner} 
                disabled={loading || (isPerfectTie && !manualWinner)} 
                className="w-full bg-green-500 text-black font-bold py-4 rounded-xl text-lg disabled:opacity-50 mb-3 active:scale-95 transition-transform select-none touch-manipulation"
              >
                ✅ Conferma vincitore e prossimo
              </button>
            </div>
          )}

          <button 
            onClick={skipUnsoldRound} 
            disabled={loading} 
            className="w-full bg-gray-900 border border-gray-700 text-gray-400 font-bold py-3 rounded-xl text-xs active:scale-95 transition-transform select-none touch-manipulation"
          >
            🚫 Segna come Invenduto / Salta Round
          </button>
        </div>
      )}

      {/* Lista Giocatori Assegnati */}
      <div className="border-t border-gray-800 pt-6">
        <h2 className="text-lg font-bold mb-4">📋 Giocatori Assegnati ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-xs text-gray-500">Nessun calciatore ancora aggiudicato.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map(item => (
              <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-bold text-white">{item.player_name}</p>
                    <p className="text-xs text-yellow-400 font-medium">
                      {item.winning_amount} cr — <span className="text-gray-300">{item.teams?.name}</span>
                    </p>
                  </div>
                  <button 
                    onClick={() => deleteHistoryItem(item.id)} 
                    className="text-red-400 text-xs px-2 py-1 bg-red-950/40 border border-red-900 rounded active:scale-95 transition-transform select-none touch-manipulation"
                  >
                    🗑 Annulla
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-gray-800/60">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-500">Cambia:</span>
                    <select
                      value={item.winning_team_id}
                      onChange={e => changeWinnerTeam(item.id, e.target.value)}
                      className="bg-black border border-gray-700 rounded px-2 py-1 text-white text-xs"
                    >
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => toggleHistoryBids(item.round_id, item.id)}
                    className="text-xs text-gray-400 underline"
                  >
                    {expandedHistoryId === item.id ? 'Nascondi buste ▲' : 'Vedi buste ▼'}
                  </button>
                </div>

                {expandedHistoryId === item.id && (
                  <div className="mt-3 bg-black/60 p-2 rounded border border-gray-800 text-xs">
                    <p className="text-gray-500 font-bold mb-1">Riepilogo Tutte le Buste:</p>
                    {historyBids[item.id]?.filter(b => b.participation === 'joined').map(b => {
                      const tName = teams.find(t => t.id === b.team_id)?.name
                      return (
                        <div key={b.id} className="flex justify-between py-1 border-b border-gray-800/40">
                          <span>{tName}</span>
                          <span className="text-gray-400">{b.revealed_player_given || '—'} ({b.revealed_purchase_price || 0}+{b.revealed_extra_credits || 0})</span>
                          <span className="font-bold">{b.revealed_total} cr</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}